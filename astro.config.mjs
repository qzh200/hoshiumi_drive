// astro.config.mjs —— drive 前端构建配置
//
// 设计：
//   - output: 'static' — Astro 生成纯静态站点（dist/）。
//   - 部署时由 postbuild 把 functions/ 复制到 dist/functions/，
//     这样 wrangler pages deploy dist 可以同时把静态产物与 Pages Functions 一起发出去。
//   - 不引 Tailwind（仿博客风格已在 global.css 中以纯 CSS 实现，更轻）。
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: undefined, // 由 config/site.yaml 提供，写死容易两边漂
  build: {
    format: 'directory',
  },
  vite: {
    build: {
      // 函数里只需要静态 import _config.generated.json；
      // 让 vite 把它打到 dist 即可，不需要特殊处理。
    },
  },
});
