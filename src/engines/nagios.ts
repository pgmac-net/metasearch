import axios from "axios";

import { fuzzyIncludes, rateLimit } from "../util";

// Status bitmask values from statusjson.cgi
const HOST_STATE_LABELS: Record<number, string> = {
  1: "PENDING",
  2: "UP",
  4: "DOWN",
  8: "UNREACHABLE",
};

const SERVICE_STATE_LABELS: Record<number, string> = {
  1: "PENDING",
  2: "OK",
  4: "WARNING",
  8: "UNKNOWN",
  16: "CRITICAL",
};

interface HostStatus {
  name: string;
  plugin_output: string;
  last_check: number; // milliseconds
  status: number;     // bitmask
}

let baseUrl: string;
let graphsPath: string | undefined;
let getHosts: (() => Promise<Record<string, HostStatus>>) | undefined;
// servicelist (without details) returns { hostname: { servicename: bitmask } }
let getServices:
  | (() => Promise<Record<string, Record<string, number>>>)
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
      try {
        const res = await client.get("/statusjson.cgi", {
          params: { query: "hostlist", details: true, formatoptions: "whitespace" },
        });
        return (res.data?.data?.hostlist ?? {}) as Record<string, HostStatus>;
      } catch (e) {
        console.error("Nagios: failed to fetch host list", e);
        return {};
      }
    }, 1);

    getServices = rateLimit(async () => {
      try {
        const res = await client.get("/statusjson.cgi", {
          params: { query: "servicelist", formatoptions: "whitespace" },
        });
        return (res.data?.data?.servicelist ?? {}) as Record<
          string,
          Record<string, number>
        >;
      } catch (e) {
        console.error("Nagios: failed to fetch service list", e);
        return {};
      }
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
      const state = HOST_STATE_LABELS[status.status] ?? `STATE(${status.status})`;
      results.push({
        modified: status.last_check ? Math.round(status.last_check / 1000) : undefined,
        snippet: status.plugin_output || undefined,
        title: `${hostname} [${state}]`,
        url: `${baseUrl}/nagios/cgi-bin/extinfo.cgi?type=1&host=${encodeURIComponent(hostname)}`,
      });
    }

    for (const [hostname, serviceMap] of Object.entries(services)) {
      for (const [serviceName, statusBitmask] of Object.entries(serviceMap)) {
        if (!fuzzyIncludes(hostname, q) && !fuzzyIncludes(serviceName, q))
          continue;
        const state = SERVICE_STATE_LABELS[statusBitmask] ?? `STATE(${statusBitmask})`;
        results.push({
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
