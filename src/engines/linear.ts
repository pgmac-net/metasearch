import axios, { AxiosInstance } from "axios";

import { getUnixTime } from "../util";

interface Issue {
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  updatedAt: string;
  state: { name: string } | null;
  team: { name: string } | null;
}

let client: AxiosInstance | undefined;

const engine: Engine = {
  id: "linear",
  init: ({ token }: { token: string }) => {
    client = axios.create({
      baseURL: "https://api.linear.app",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
    });
  },
  isSnippetLarge: false,
  name: "Linear",
  search: async q => {
    if (!client) {
      throw Error("Engine not initialized");
    }

    try {
      const response = await client.post("/graphql", {
        query: `query Search($query: String!) {
          issueSearch(query: $query, first: 50) {
            nodes {
              identifier
              title
              description
              url
              updatedAt
              state { name }
              team { name }
            }
          }
        }`,
        variables: { query: q },
      });

      if (response.data?.errors) {
        console.error(`Linear GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      const nodes: Issue[] = response.data?.data?.issueSearch?.nodes ?? [];

      return nodes.map(issue => ({
        modified: getUnixTime(issue.updatedAt),
        snippet: issue.description ?? undefined,
        title: `[${issue.team?.name ?? "Linear"}] ${issue.identifier}: ${issue.title}`,
        url: issue.url,
      }));
    } catch (ex: any) {
      const body = ex?.response?.data ? JSON.stringify(ex.response.data) : "(no response body)";
      console.error(`Linear search error: ${ex} — response body: ${body}`);
      return [];
    }
  },
};

export default engine;
