import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/Code_Flash_Tool/" : "/",
  plugins: [vinext()],
}));
