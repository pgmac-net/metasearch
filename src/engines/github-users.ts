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
let users: string[] | undefined;

const engine: Engine = {
  id: "github_users",
  init: ({
    usernames,
    origin = "https://api.github.com",
    token,
  }: {
    usernames: string[];
    origin: string;
    token: string;
  }) => {
    const axiosClient = axios.create({
      baseURL: origin,
      headers: { Authorization: `bearer ${token}` },
    });
    client = axiosClient;

    getRepos = rateLimit(async () => {
      const reposByUser = new Map<string, Set<Repo>>();

      for (const user of usernames) {
        let cursor: string | undefined;
        const repos = new Set<Repo>();
        while (true) {
          const response = await axiosClient.post(
            "/graphql",
            JSON.stringify({
              query: `query {
                user(login: "${user}") { repositories(first: 100${
                  cursor ? `, after: \"${cursor}\"` : ""
                }) {
                  edges { node { description isArchived isFork name } }
                  pageInfo { endCursor hasNextPage }
                } } }`,
            })
          );

          const { data } = response.data || {};

          if (!data || !data.user || !data.user.repositories) {
            console.warn(
              `User "${user}" not found, has no repositories, or access is restricted.`
            );
            break;
          }

          const { edges = [], pageInfo = { hasNextPage: false } } =
            data.user.repositories || {};
          edges
            .map((e: { node: Repo }) => e.node)
            .forEach((r: Repo) => repos.add(r));

          if (pageInfo.hasNextPage) {
            cursor = pageInfo.endCursor;
          } else {
            break;
          }
        }
        reposByUser.set(user, repos);
      }

      return reposByUser;
    }, 1);
    users = usernames;
  },
  name: "GitHub Users",
  search: async (q) => {
    if (!(client && getRepos && users)) {
      throw Error("Engine not initialized");
    }

    const results: Result[] = [];

    for (const user of users) {
      // Search repo names and descriptions
      if (getRepos) {
        const repos = await getRepos();
        const userRepos = repos.get(user) || new Set();

        if (!userRepos.size) {
          console.warn(`No repositories found for user: ${user}`);
          continue;
        }

        results.push(
          ...Array.from(userRepos)
            .filter(
              (r) =>
                !r.isArchived &&
                !r.isFork &&
                [r.description, r.name].some((s) => s && fuzzyIncludes(s, q))
            )
            .sort((a, b) => (a.name > b.name ? 1 : -1))
            .map((r) => ({
              snippet:
                r.description?.replace(/ *:[a-z-]+: */g, "") || undefined,
              title: `Repo ${user}/${r.name}`,
              url: `https://github.com/${user}/${r.name}`,
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
                q: /\b(is|author|user):\w/.test(q)
                  ? /\buser:\w/.test(q)
                    ? q
                    : `user:${user} ${q}`
                  : `user:${user} \"${escapeQuotes(q)}\"`,
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
        } catch (error) {
          console.error(`Error fetching issues and pull requests: ${error}`);
        }
      }
    }

    return results;
  },
};

export default engine;