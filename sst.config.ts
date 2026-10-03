/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app() {
    return {
      name: "models-koft-dev",
      home: "cloudflare",
    };
  },
  async run() {
    const { spawnSync } = await import("child_process");

    const ret = spawnSync("./script/build.ts", [], {
      cwd: "./packages/web",
      stdio: "inherit",
    });
    if (ret.status !== 0) throw new Error("Build failed");

    const posthog = new sst.Secret("PosthogToken");
    const endpoint = new sst.Secret("LakeEndpoint");
    const token = new sst.Secret("LakeToken");
    const worker = new sst.cloudflare.Worker("Server", {
      url: true,
      domain: "models.koft.dev",
      link: $resolve([endpoint.value, token.value]).apply((values) => {
        if (!/^https:\/\/[a-f0-9]{32}\.ingest\.cloudflare\.com\/?$/.test(values[0]))
          throw new Error("LakeEndpoint must be a Cloudflare stream endpoint");
        if (!values[1].trim()) throw new Error("LakeToken must not be empty");
        return [posthog, endpoint, token];
      }),
      handler: "./packages/function/src/worker.ts",
      assets: {
        directory: "./packages/web/dist",
      },
      transform: {
        worker: {
          observability: { enabled: true },
        },
      },
    });

    return {
      url: worker.url,
    };
  },
});
