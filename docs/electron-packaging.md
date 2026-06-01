# Electron 打包说明

本文只描述 Pipeline Workbench 产物的运行和打包步骤，不包含会话探索记录、技能设计记录或平台抓包临时产物。

## 前置条件

- 开发机需要安装 Node.js 和 npm。
- 首次进入仓库后执行 `npm install` 安装依赖。
- 真实连接构建/发布平台时，需要在应用内配置 workflow 账号，或通过本地环境变量提供账号信息。

## 常用命令

```bash
npm run check
npm run build
npm run electron
```

- `npm run check`：执行语法检查、核心模型检查、UI 语义检查、平台适配层检查、Electron 包配置检查，并执行一次前端构建。
- `npm run build`：使用 Vite 生成前端静态资源到 `public/`。
- `npm run electron`：构建前端后启动 Electron 桌面应用。

## Windows 打包

```bash
npm run electron:pack:win
```

输出目录为 `dist-electron/`。该目录是构建产物，不需要提交到源码仓库。

当前 Electron Builder 配置包含：

- `win-unpacked/`：免安装目录包，可直接运行 `Pipeline Workbench.exe`。
- NSIS 安装包：适合分发给普通用户安装。
- portable 包：适合无安装运行。

## macOS 与 Linux 打包

```bash
npm run electron:pack
```

该命令会按当前平台生成目录包。`package.json` 中同时保留了 macOS `dmg/zip` 和 Linux `AppImage/deb` 的目标配置；实际跨平台打包通常建议在对应系统或 CI runner 上执行。

## 新手机器运行说明

打包后的桌面应用自带 Electron 和 Node 运行时。普通用户不需要安装 Node.js、npm 或 curl。应用内部 HTTP 请求由 Node 标准库实现，避免依赖系统 curl 命令。

## 不提交的内容

以下内容属于本地运行状态或构建产物，不进入仓库：

- `.env`
- `.workbench-secrets.json`
- `.workbench-cache/`
- `tmp/`
- `dist-electron/`
- `public/assets/`
- `public/index.html`

`public/assets/` 和 `public/index.html` 由 `npm run build` 生成。
