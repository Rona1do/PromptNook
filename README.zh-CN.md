<div align="center">
  <img src="public/promptnook-icon.png" alt="PromptNook 图标" width="128" />
  <h1>PromptNook</h1>
  <p><strong>把散落的 Prompt 变成可编辑的 ComfyUI 工作流。</strong></p>
  <p>在一个私密、本地优先的工作区中管理 Prompt 配方、模型、LoRA、触发词和生成参数。</p>

  **[立即打开浏览器工作区](https://rona1do.github.io/PromptNook/)** ·
  [版本列表](https://github.com/Rona1do/PromptNook/releases) ·
  [ComfyUI 导出说明](docs/COMFYUI_EXPORT.md)
</div>

[English](README.md)

> **现在就可以完成一次真实流程。** 浏览器工作区会把修改保存在当前浏览器中，不上传数据，并能直接下载真正的 ComfyUI Workflow JSON 0.4。扫描本地文件夹和完整性校验备份仍属于桌面版功能。

![PromptNook 导出到 ComfyUI 的演示](docs/promptnook-comfyui-demo.gif)

## 60 秒上手

1. 打开[浏览器工作区](https://rona1do.github.io/PromptNook/)，不需要安装或注册。
2. 打开示例 **Neon street in the rain**，查看 checkpoint、Prompt 和生成参数。
3. 点击 **Export ComfyUI workflow**，再把下载的 JSON 载入 ComfyUI。

你所做的修改会保存在该浏览器的本地存储中。Windows 桌面版进一步提供模型/LoRA 文件夹扫描、SQLite 数据库、可迁移备份和操作系统凭据保护。

## 项目定位

成功生成一张图所依赖的不只是 Prompt 文本，还包括 checkpoint、按顺序加载的 LoRA、触发词、采样器、调度器、种子、尺寸，以及解释“为什么这样有效”的备注。PromptNook 把这些信息连接起来，并能将保存的 checkpoint 配方导出为可编辑的 ComfyUI 节点图。

PromptNook 不要求注册云端账号，也不会上传你的资料库；相比普通文本文件，它能保留复现结果所需的资源与参数。

## 主要功能

- **可实际使用的浏览器工作区**：创建和编辑配方、片段与工作区，刷新后数据仍在，并可直接下载 checkpoint 类型的 ComfyUI 工作流。
- **ComfyUI Workflow JSON 0.4 导出**：自动连接 checkpoint、按顺序加载的 LoRA、正负 Prompt、尺寸、采样器、调度器、步数、CFG 和种子。
- **本地模型目录**：桌面版直接扫描现有 checkpoint、diffusion model 和 LoRA 文件夹，不要求重新手工建库。
- **自定义工作区**：可填写任意模型、客户或工作流名称，不固定为三种预设模型。
- **配方与片段**：管理完整 Prompt、可复用短语、负面词、标签、收藏、备注和修订历史。
- **Prompt Studio**：组合片段，并保留生成参数。
- **语言灵活**：翻译目标由用户配置，支持本地或 OpenAI-compatible 服务，默认关闭翻译。
- **桌面端可靠备份**：支持内容寻址媒体、完整性校验、恢复模式、回收站、JSON/CSV 和 `.promptnook` 迁移包。
- 默认数据不包含成人向预设，也不对某一种内容类型作特殊假设。

## 界面截图

<details>
  <summary>Prompt 资料库、创作台与本地模型目录</summary>

  ![Prompt 成品库](docs/screenshots/recipes.png)

  ![Prompt 创作台](docs/screenshots/studio.png)

  ![本地模型与 LoRA 目录](docs/screenshots/models-and-loras.png)
</details>

截图使用仓库自带的示例数据，不包含维护者的私人资料库或个人文件路径。

## 语言策略

仓库和软件主要界面以英文为主，并保留完整中文说明。Prompt 内容和翻译目标本身不限制语言；v0.2 已迁移私人原型遗留的主要中文界面文案，少量底层 Rust 诊断信息仍列在后续本地化计划中。完整的简体中文 UI 仍需先迁入可审阅的本地化资源后再提供，不会在此之前笼统宣称“支持所有界面语言”。具体见 [ROADMAP.md](ROADMAP.md)。

## ComfyUI 导出

在浏览器工作区或 Windows 桌面版中打开已有配方，点击 **Export ComfyUI workflow**，即可下载或写出可编辑的 ComfyUI Workflow JSON 0.4 文件。当前版本使用 ComfyUI 核心节点，支持基于 checkpoint 的文生图配方；FLUX/diffusion model 需要不同的节点图模板，因此当前会明确提示不支持，而不是生成看似成功但无法正确运行的文件。兼容性和字段映射见 [docs/COMFYUI_EXPORT.md](docs/COMFYUI_EXPORT.md)。

## 当前平台

目前仅在 **Windows 10/11** 上开发和验证。代码结构具备跨平台基础，但在 macOS 和 Linux 的打包流程验证完成前，不会宣称正式支持。

在建立可信代码签名流程前，项目不会公开发布 Windows 安装包；源码版本仍可供审阅和自行构建。详见[代码签名策略](docs/CODE_SIGNING.md)。

## 本地开发

请先安装 Node.js 24.15+、Rust stable、Cargo、Windows WebView2 和 Tauri 2 所需的系统依赖。

```bash
git clone https://github.com/Rona1do/PromptNook.git
cd PromptNook
npm ci
npm run tauri:dev
```

只运行浏览器工作区：

```bash
npm run dev
```

质量检查：

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 隐私

翻译默认关闭。启用后，只有你主动要求翻译的文字会发送到所配置的服务。API 密钥保存在操作系统凭据管理器中，不写入 SQLite。详细说明见 [docs/PRIVACY.md](docs/PRIVACY.md)。Windows 桌面数据目录为 `%LOCALAPPDATA%\PromptNook\vault`，不会自动读取原私人项目的数据。

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[ROADMAP.md](ROADMAP.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 和 [SECURITY.md](SECURITY.md)。

使用场景、工作流想法和早期反馈欢迎发布到 [GitHub Discussions](https://github.com/Rona1do/PromptNook/discussions)；可复现的问题和范围明确的功能建议请提交到 [Issues](https://github.com/Rona1do/PromptNook/issues)。

## 许可证

本项目采用 [MIT License](LICENSE)。
