import {
  filterCatalogByModelType,
  filterModelsByModelType,
  filterProvidersByModelType,
  InvalidModelTypeError,
  MODEL_TYPES,
  parseModelTypes,
} from "@models.dev/core/src/filter.js";
import type { ModelTypeValue } from "@models.dev/core/src/filter.js";

export interface Env {
  ASSETS: any;
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/model-schema.json") {
      const apiResponse = await catalogResponse(url, request, env, "api");
      if (!apiResponse.ok) return apiResponse;
      const providers = (await apiResponse.json()) as Record<
        string,
        { models: Record<string, unknown> }
      >;

      const modelIds: string[] = [];
      for (const [providerId, provider] of Object.entries(providers)) {
        for (const modelId of Object.keys(provider.models)) {
          modelIds.push(`${providerId}/${modelId}`);
        }
      }

      const schema = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://models.koft.dev/model-schema.json",
        $defs: {
          Model: {
            type: "string",
            enum: modelIds.sort(),
            description: "AI model identifier in provider/model format",
          },
        },
      };

      return new Response(JSON.stringify(schema, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (url.pathname === "/api.json") {
      return catalogResponse(url, request, env, "api");
    } else if (url.pathname === "/models.json") {
      return catalogResponse(url, request, env, "models");
    } else if (url.pathname === "/catalog.json") {
      return catalogResponse(url, request, env, "catalog");
    } else if (
      url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname === "/index"
    ) {
      url.pathname = "/_index";
    } else if (isHtmlRoute(url.pathname)) {
      url.pathname = htmlRouteAssetPath(url.pathname);
    } else if (url.pathname.startsWith("/logos/")) {
      const logoResponse = await env.ASSETS.fetch(
        new Request(url.toString(), request),
      );

      if (logoResponse.status === 404) {
        const defaultUrl = new URL(url);
        defaultUrl.pathname = "/logos/default.svg";
        return await env.ASSETS.fetch(
          new Request(defaultUrl.toString(), request),
        );
      }

      return logoResponse;
    }

    const response = await env.ASSETS.fetch(new Request(url.toString(), request));
    if (response.status !== 404) return response;

    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  },
};

type CatalogEndpoint = "api" | "models" | "catalog";

async function catalogResponse(
  url: URL,
  request: Request,
  env: Env,
  endpoint: CatalogEndpoint,
) {
  let filter;
  try {
    filter = parseModelTypes(url.searchParams.get("type"));
  } catch (error) {
    if (!(error instanceof InvalidModelTypeError)) throw error;
    return Response.json(
      {
        error: error.message,
        allowed: [...MODEL_TYPES, "all"],
      },
      {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
      },
    );
  }

  const assetUrl = new URL(url);
  const suffix = filter === "default"
    ? ""
    : filter === "all"
      ? "-all"
      : filter.length === 1
        ? `-${filter[0]}`
        : undefined;
  assetUrl.pathname = `/_${endpoint}${suffix ?? "-all"}.json`;
  assetUrl.search = "";
  const assetResponse = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), request),
  );
  if (!assetResponse.ok) return assetResponse;

  if (suffix !== undefined) {
    const headers = new Headers(assetResponse.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=3600");
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      headers,
    });
  }

  const value = await assetResponse.json();
  const filtered = endpoint === "api"
    ? filterProvidersByModelType(
        value as Record<string, CatalogProvider>,
        filter,
      )
    : endpoint === "models"
      ? filterModelsByModelType(
          value as Record<string, CatalogModel>,
          filter,
        )
      : filterCatalogByModelType(
          value as {
            providers: Record<string, CatalogProvider>;
            models: Record<string, CatalogModel>;
          },
          filter,
        );

  const headers = new Headers(assetResponse.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(JSON.stringify(filtered), { headers });
}

interface CatalogModel {
  type?: ModelTypeValue;
}

interface CatalogProvider {
  models: Record<string, CatalogModel>;
}

function isHtmlRoute(pathname: string) {
  return (
    pathname === "/models" ||
    pathname === "/providers" ||
    pathname === "/labs" ||
    pathname.startsWith("/models/") ||
    pathname.startsWith("/providers/") ||
    pathname.startsWith("/labs/")
  );
}

function htmlRouteAssetPath(pathname: string) {
  const normalized =
    pathname !== "/" && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return `${normalized}/index.html`;
}
