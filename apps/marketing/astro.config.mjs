import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://yantrix.invalid",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});
