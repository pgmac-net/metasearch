import axios, { AxiosInstance } from "axios";

import { getUnixTime, trimLines } from "../util";

let markedParse: ((src: string) => string) | undefined;
async function getMarkedParse(): Promise<(src: string) => string> {
  if (!markedParse) {
    const { marked } = await import("marked");
    markedParse = (src: string) => marked.parse(src) as string;
  }
  return markedParse;
}

let client: AxiosInstance | undefined;

const engine: Engine = {
  id: "gitlab",
  init: ({
    origin = "https://gitlab.com",
    token,
  }: {
    origin: string;
    token: string;
  }) => {
    const axiosClient = axios.create({
      baseURL: `${origin}/api/v4`,
      headers: { Authorization: `bearer ${token}` },
    });
    client = axiosClient;
  },
  name: "GitLab",
  search: async q => {
    if (!client) {
      throw Error("Engine not initialized");
    }

    // https://docs.gitlab.com/ee/api/merge_requests.html#list-merge-requests
    const data: {
      description: string;
      title: string;
      updated_at: string;
      web_url: string;
    }[] = (
      await client.get("/merge_requests", {
        params: { scope: "all", search: q },
      })
    ).data;

    const parse = await getMarkedParse();
    return data.map(mr => ({
      modified: getUnixTime(mr.updated_at),
      snippet: `<blockquote>${parse(
        trimLines(mr.description, q),
      )}</blockquote>`,
      title: mr.title,
      url: mr.web_url,
    }));
  },
};

export default engine;
