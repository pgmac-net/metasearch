import axios from "axios";

import { fuzzyIncludes, rateLimit } from "../util";

const HOST_STATES = ["UP", "DOWN", "UNREACHABLE"];
const SERVICE_STATES = ["OK", "WARNING", "CRITICAL", "UNKNOWN"];

interface HostStatus {
  current_state: number;
  plugin_output: string;
  last_check: number;
}

interface ServiceStatus {
  current_state: number;
  plugin_output: string;
  last_check: number;
}

let baseUrl: string;
let graphsPath: string | undefined;
let getHosts: (() => Promise<Record<string, HostStatus>>) | undefined;
let getServices:
  | (() => Promise<Record<string, Record<string, ServiceStatus>>>)
  | undefined;

const engine: Engine = {
  id: "nagios",
  init: ({
    host,
    username,
    password,
    path = "/nagios",
    protocol = "https",
    graphsPath: gp,
  }: {
    host: string;
    username: string;
    password: string;
    path?: string;
    protocol?: string;
    graphsPath?: string;
  }) => {
    baseUrl = `${protocol}://${host}`;
    graphsPath = gp;

    const client = axios.create({
      baseURL: `${baseUrl}${path}/cgi-bin`,
      auth: { username, password },
    });

    getHosts = rateLimit(async () => {
      const res = await client.get("/statusjson.cgi", {
        params: { query: "hostlist", formatoptions: "whitespace" },
      });
      return (res.data?.result?.data?.hostlist ?? {}) as Record<
        string,
        HostStatus
      >;
    }, 1);

    getServices = rateLimit(async () => {
      const res = await client.get("/statusjson.cgi", {
        params: { query: "servicelist", formatoptions: "whitespace" },
      });
      return (res.data?.result?.data?.servicelist ?? {}) as Record<
        string,
        Record<string, ServiceStatus>
      >;
    }, 1);
  },
  name: "Nagios",
  search: async q => {
    if (!(getHosts && getServices)) {
      throw new Error("Engine not initialized");
    }

    const [hosts, services] = await Promise.all([getHosts(), getServices()]);
    const results: Result[] = [];

    for (const [hostname, status] of Object.entries(hosts)) {
      if (!fuzzyIncludes(hostname, q)) continue;
      const state = HOST_STATES[status.current_state] ?? "UNKNOWN";
      results.push({
        modified: status.last_check || undefined,
        snippet: status.plugin_output || undefined,
        title: `${hostname} [${state}]`,
        url: `${baseUrl}/nagios/cgi-bin/extinfo.cgi?type=1&host=${encodeURIComponent(hostname)}`,
      });
    }

    for (const [hostname, serviceMap] of Object.entries(services)) {
      for (const [serviceName, status] of Object.entries(serviceMap)) {
        if (!fuzzyIncludes(hostname, q) && !fuzzyIncludes(serviceName, q))
          continue;
        const state = SERVICE_STATES[status.current_state] ?? "UNKNOWN";
        results.push({
          modified: status.last_check || undefined,
          snippet: status.plugin_output || undefined,
          title: `${hostname}: ${serviceName} [${state}]`,
          url: `${baseUrl}/nagios/cgi-bin/extinfo.cgi?type=2&host=${encodeURIComponent(hostname)}&service=${encodeURIComponent(serviceName)}`,
        });
        if (graphsPath) {
          results.push({
            title: `Graph: ${hostname} / ${serviceName}`,
            url: `${baseUrl}${graphsPath}/index.php/graph?host=${encodeURIComponent(hostname)}&srv=${encodeURIComponent(serviceName)}`,
          });
        }
      }
    }

    return results;
  },
};

export default engine;
