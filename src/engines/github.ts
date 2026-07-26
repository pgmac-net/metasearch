import axios, { AxiosInstance } from "axios";

import { escapeQuotes, fuzzyIncludes, getUnixTime, rateLimit } from "../util";

let markedParse: ((src: string) => string) | undefined;
async function getMarkedParse(): Promise<(src: string) => string> {
  if (!markedParse) {
    const { marked } = await import("marked");
    markedParse = (src: string) => marked.parse(src) as string;
  }
  return markedParse;
}

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

    const repos = await getRepos();

    for (const org of orgs) {
      const orgRepos = repos.get(org) || new Set();

      const [
        repoResults,
        issueResults,
        workflowResults,
        advisoryResults,
        discussionResults,
        wikiResults,
      ] = await Promise.all([
        searchRepos(orgRepos, org, q),
        searchIssues(client, org, q),
        searchWorkflows(client, org, q),
        searchSecurity(client, org, q),
        searchDiscussions(client, org, q),
        searchWiki(client, Array.from(orgRepos), org, q),
      ]);

      results.push(
        ...repoResults,
        ...issueResults,
        ...workflowResults,
        ...advisoryResults,
        ...discussionResults,
        ...wikiResults,
      );
    }

    return results;
  },
};

async function searchRepos(
  orgRepos: Set<Repo>,
  org: string,
  q: string,
): Promise<Result[]> {
  return Array.from(orgRepos)
    .filter(
      (r) =>
        !r.isArchived &&
        !r.isFork &&
        [r.description, r.name].some((s) => fuzzyIncludes(s, q)),
    )
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .map((r) => ({
      snippet: r.description?.replace(/ *:[a-z-]+: */g, "") || undefined,
      title: `Repo ${org}/${r.name}`,
      url: `https://github.com/${org}/${r.name}`,
    }));
}

async function searchIssues(
  client: AxiosInstance,
  org: string,
  q: string,
): Promise<Result[]> {
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
            : `org:${org} "${escapeQuotes(q)}"`,
        },
      })
    ).data;
    const parse = await getMarkedParse();
    return data.items.map((item) => ({
      modified: getUnixTime(item.updated_at),
      snippet: item.body
        ? `<blockquote>${parse(item.body)}</blockquote>`
        : undefined,
      title: `${item.pull_request ? "PR" : "Issue"} in ${
        item.html_url.match(/github\.com\/([^\/]+\/[^\/]+)/)?.[1]
      }: ${item.title}`,
      url: item.html_url,
    }));
  } catch {
    return [];
  }
}

async function searchWorkflows(
  client: AxiosInstance,
  org: string,
  q: string,
): Promise<Result[]> {
  try {
    const { data } = await client.get("/search/code", {
      params: {
        q: `org:${org} path:.github/workflows ${escapeQuotes(q)}`,
        per_page: 20,
      },
    });
    return (data.items || []).map((item: any) => ({
      title: `Workflow: ${item.path.replace(".github/workflows/", "")} in ${item.repository.full_name}`,
      url: item.html_url,
    }));
  } catch {
    return [];
  }
}

async function searchSecurity(
  client: AxiosInstance,
  org: string,
  q: string,
): Promise<Result[]> {
  const results: Result[] = [];

  await Promise.all([
    (async () => {
      try {
        const { data } = await client.get(`/orgs/${org}/security-advisories`, {
          params: { per_page: 50 },
        });
        for (const a of data || []) {
          if (
            fuzzyIncludes(a.title, q) ||
            fuzzyIncludes(a.description, q) ||
            fuzzyIncludes(a.summary, q)
          ) {
            results.push({
              title: `Security advisory: ${a.title || a.summary}`,
              url: a.html_url,
              snippet: a.description || a.summary,
              modified: a.updated_at ? getUnixTime(a.updated_at) : undefined,
            });
          }
        }
      } catch {
        // Security advisories endpoint may not be available
      }
    })(),
    (async () => {
      try {
        const { data } = await client.get(`/orgs/${org}/dependabot/alerts`, {
          params: { per_page: 50, state: "open" },
        });
        for (const a of data || []) {
          const text =
            a.security_advisory?.summary ||
            a.security_advisory?.description ||
            a.package?.name ||
            "";
          if (fuzzyIncludes(text, q)) {
            results.push({
              title: `Dependabot: ${a.security_advisory?.summary || a.package?.name || "alert"}`,
              url: a.html_url,
              snippet: a.security_advisory?.description,
              modified: a.created_at ? getUnixTime(a.created_at) : undefined,
            });
          }
        }
      } catch {
        // Dependabot alerts endpoint may not be available
      }
    })(),
    (async () => {
      try {
        const { data } = await client.get(`/orgs/${org}/code-scanning/alerts`, {
          params: { per_page: 50 },
        });
        for (const a of data || []) {
          const text = a.rule?.name || a.rule?.description || "";
          if (fuzzyIncludes(text, q)) {
            results.push({
              title: `Code scanning: ${a.rule?.name || "alert"}`,
              url: a.html_url,
              snippet: a.rule?.description,
              modified: a.created_at ? getUnixTime(a.created_at) : undefined,
            });
          }
        }
      } catch {
        // Code scanning alerts endpoint may not be available
      }
    })(),
    (async () => {
      try {
        const { data } = await client.get(`/orgs/${org}/secret-scanning/alerts`, {
          params: { per_page: 50, state: "open" },
        });
        for (const a of data || []) {
          if (fuzzyIncludes(a.secret_type_display_name, q)) {
            results.push({
              title: `Secret scanning: ${a.secret_type_display_name}`,
              url: a.html_url,
              modified: a.created_at ? getUnixTime(a.created_at) : undefined,
            });
          }
        }
      } catch {
        // Secret scanning alerts endpoint may not be available
      }
    })(),
  ]);

  return results;
}

async function searchDiscussions(
  client: AxiosInstance,
  org: string,
  q: string,
): Promise<Result[]> {
  try {
    const response = await client.post(
      "/graphql",
      JSON.stringify({
        query: `{
          search(query: "org:${org} is:discussion ${escapeQuotes(q)}", type: DISCUSSION, first: 50) {
            edges {
              node {
                ... on Discussion {
                  title
                  url
                  body
                  updatedAt
                }
              }
            }
          }
        }`,
      }),
    );

    const edges = response.data?.data?.search?.edges || [];
    const parse = await getMarkedParse();
    return edges.map(({ node }: any) => ({
      title: `Discussion: ${node.title}`,
      url: node.url,
      snippet: node.body
        ? `<blockquote>${parse(node.body)}</blockquote>`
        : undefined,
      modified: node.updatedAt ? getUnixTime(node.updatedAt) : undefined,
    }));
  } catch {
    return [];
  }
}

async function searchWiki(
  client: AxiosInstance,
  repos: Repo[],
  org: string,
  q: string,
): Promise<Result[]> {
  const activeRepos = repos.filter((r) => !r.isArchived && !r.isFork);

  const pageResults = await Promise.all(
    activeRepos.map(async (repo) => {
      try {
        const { data } = await client.get(
          `/repos/${org}/${repo.name}/contents`,
          { params: { ref: "wiki/master" } },
        );
        if (!Array.isArray(data)) {
          return [] as Result[];
        }
        return data
          .filter(
            (f: any) =>
              f.type === "file" &&
              f.name.endsWith(".md") &&
              fuzzyIncludes(f.name.replace(/\.md$/i, ""), q),
          )
          .map(
            (f: any): Result => ({
              title: `Wiki: ${f.name.replace(/\.md$/i, "")} (${org}/${repo.name})`,
              url: `https://github.com/${org}/${repo.name}/wiki/${encodeURIComponent(
                f.name.replace(/\.md$/i, ""),
              )}`,
            }),
          );
      } catch {
        return [] as Result[];
      }
    }),
  );

  return pageResults.flat();
}

export default engine;

