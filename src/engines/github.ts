import axios, { AxiosInstance } from "axios";
import * as marked from "marked";

import { escapeQuotes, fuzzyIncludes, getUnixTime, rateLimit } from "../util";

interface Repo {
  description: null | string;
  isArchived: boolean;
  isFork: boolean;
  name: string;
}

let client: AxiosInstance | undefined;
let getRepos: (() => Promise<Map<string, Set<Repo>>>) | undefined;
let orgs: string[] | undefined;

const engine: Engine = {
  id: "github",
  init: ({
    organizations,
    origin = "https://api.github.com",
    token,
  }: {
    organizations: string[];
    origin: string;
    token: string;
  }) => {
    const axiosClient = axios.create({
      baseURL: origin,
      headers: { Authorization: `bearer ${token}` },
    });
    client = axiosClient;

    getRepos = rateLimit(async () => {
      const reposByOrg = new Map<string, Set<Repo>>();

      for (const org of organizations) {
        let cursor: string | undefined;
        const repos = new Set<Repo>();
        while (true) {
          const response = await axiosClient.post(
            "/graphql",
            JSON.stringify({
              query: `query {
        organization(login: "${org}") { repositories(first: 100${
          cursor ? `, after: \"${cursor}\"` : ""
        }) {
            edges { node { description isArchived isFork name } }
            pageInfo { endCursor hasNextPage }
        } } }`,
            })
          );

          const { data } = response.data || {};

          if (!data || !data.organization) {
            console.warn(`Organization "${org}" not found or no access.`);
            break;
          }

          const { edges, pageInfo } = data.organization.repositories;
          edges.map((e: { node: Repo }) => e.node).forEach((r: Repo) => repos.add(r));

          if (pageInfo.hasNextPage) {
            cursor = pageInfo.endCursor;
          } else {
            break;
          }
        }
        reposByOrg.set(org, repos);
      }

      return reposByOrg;
    }, 1);
    orgs = organizations;
  },
  name: "GitHub",
  search: async (q) => {
    if (!(client && getRepos && orgs)) {
      throw Error("Engine not initialized");
    }

    const results: Result[] = [];

    for (const org of orgs) {
      // Search repo names and descriptions
      if (getRepos) {
        const repos = await getRepos();
        const orgRepos = repos.get(org) || new Set();

        results.push(
          ...Array.from(orgRepos)
            .filter(
              (r) =>
                !r.isArchived &&
                !r.isFork &&
                [r.description, r.name].some((s) => fuzzyIncludes(s, q))
            )
            .sort((a, b) => (a.name > b.name ? 1 : -1))
            .map((r) => ({
              snippet:
                r.description?.replace(/ *:[a-z-]+: */g, "") || undefined,
              title: `Repo ${org}/${r.name}`,
              url: `https://github.com/${org}/${r.name}`,
            }))
        );
      }

      // Search issues and pull requests
      if (client) {
        try {
          const data: {
            items: {
              body: null | string;
              html_url: string;
              number: number;
              pull_request?: object;
              title: string;
              updated_at: string;
              user: { login: string };
            }[];
          } = (
            await client.get("/search/issues", {
              params: {
                per_page: 100,
                q: /\b(is|author|org):\w/.test(q)
                  ? /\borg:\w/.test(q)
                    ? q
                    : `org:${org} ${q}`
                  : `org:${org} \"${escapeQuotes(q)}\"`,
              },
            })
          ).data;

          results.push(
            ...data.items.map((item) => ({
              modified: getUnixTime(item.updated_at),
              snippet: item.body
                ? `<blockquote>${marked(item.body)}</blockquote>`
                : undefined,
              title: `${item.pull_request ? "PR" : "Issue"} in ${
                item.html_url.match(/github\.com\/([^\/]+\/[^\/]+)/)?.[1]
              }: ${item.title}`,
              url: item.html_url,
            }))
          );
        } catch {
          // Ignore errors for now
        }
      }
    }

    return results;
  },
};

export default engine;

