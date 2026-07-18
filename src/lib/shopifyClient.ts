import { desktopApi } from "./desktopApi";

export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export function createAdminClient(storeId: string, apiVersion?: string): AdminGraphqlClient {
  return {
    async graphql(query, options) {
      const payload = await desktopApi.graphql(
        storeId,
        query,
        options?.variables ?? {},
        apiVersion,
      );

      return new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  };
}

export async function externalText(url: string): Promise<string> {
  return desktopApi.httpGetText(url);
}
