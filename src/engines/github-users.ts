import axios, { AxiosInstance } from "axios";
import * as marked from "marked";

import { escapeQuotes, fuzzyIncludes, getUnixTime, rateLimit } from "../util";

interface Repo {
  description: null | string;
  isArchived: boolean;
  isFork: boolean;
  name: string;
}

interface Gist {
  description: string | null;
  id: string;
  updated_at: string;
  html_url: string;
}

let client: AxiosInstance | undefined;
let getReposAndGists: (() => Promise<Map<string, { repos: Set<Repo>, gists: Set<Gist> }>>) | undefined;
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

    getReposAndGists = rateLimit(async () => {
      const dataByUser = new Map<string, { repos: Set<Repo>, gists: Set<Gist> }>();

      for (const user of usernames) {
        let cursor: string | undefined;
        const repos = new Set<Repo>();
        const gists = new Set<Gist>();

        // Fetch repositories
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

        // Fetch gists
        try {
          const response = await axiosClient.get(`/users/${user}/gists`);
          const gistsData: Gist[] = response.data;

          gistsData.forEach((gist) => gists.add(gist));
        } catch (error) {
          console.warn(`Error fetching gists for user "${user}": ${error}`);
        }

        dataByUser.set(user, { repos, gists });
      }

      return dataByUser;
    }, 1);
    users = usernames;
  },
  name: "GitHub Users",
  search: async (q) => {
    if (!(client && getReposAndGists && users)) {
      throw Error("Engine not initialized");
    }

    const results: Result[] = [];

    for (const user of users) {
      // Search repo names and descriptions
      if (getReposAndGists) {
        const data = await getReposAndGists();
        const userData = data.get(user);

        if (!userData) {
          console.warn(`No data found for user: ${user}`);
          continue;
        }

        const { repos, gists } = userData;

        if (!repos.size && !gists.size) {
          console.warn(`No repositories or gists found for user: ${user}`);
          continue;
        }

        results.push(
          ...Array.from(repos)
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

        results.push(
          ...Array.from(gists)
            .filter((g) => g.description && fuzzyIncludes(g.description, q))
            .sort((a, b) => (a.updated_at > b.updated_at ? 1 : -1))
            .map((g) => ({
              snippet: g.description || undefined,
              title: `Gist ${user}/${g.id}`,
              url: g.html_url,
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