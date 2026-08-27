<div align="center">
  <img src="public/promptnook-icon.png" alt="PromptNook 图标" width="128" />
  <h1>PromptNook</h1>
  <p>面向生成式图像创作者的本地优先 Prompt 资料库与创作台。</p>
</div>

[English](README.md)

## 项目定位

PromptNook 用来管理完整 Prompt、可复用片段、生成参数、模型/LoRA 资料和备份。它不要求注册云端账号，桌面数据默认保存在本机 SQLite 数据库中。

## 主要功能

- 可自定义任意模型或工作流名称，不再固定为少数预设模型；各工作区的数据相互隔离。
- 管理完整 Prompt、单条片段、负面词、分类、标签、收藏、备注和修订历史。
- 在创作台组合片段并记录生成参数。
- 扫描本地 checkpoint、diffusion model 和 LoRA 文件夹，维护触发词与可用状态。
- 翻译目标可填写 `en`、`zh-CN`、`ja`、`de` 等语言代码或语言名称；翻译默认关闭。
- 支持完整性校验备份、回收站、JSON/CSV 导出和 `.promptnook` 迁移包。
- 不包含成人向预设，也不对某一种内容类型作特殊假设。

## 语言策略

仓库以英文作为协作语言，并保留中文说明。Prompt 内容和翻译目标本身不限制语言。首个公开预览版仍有部分来自私人原型的中文界面文字；下一里程碑会先把界面文案迁入标准的本地化资源，再提供完整英文界面，之后欢迎社区贡献其他语言。具体见 [ROADMAP.md](ROADMAP.md)。

## 当前平台

目前仅在 **Windows 10/11** 上开发和验证。代码结构具备跨平台基础，但在 macOS 和 Linux 的打包流程验证完成前，不会宣称正式支持。

## 本地开发

请先安装 Node.js 20+、Rust stable、Cargo、Windows WebView2 和 Tauri 2 所需的系统依赖。

```bash
git clone https://github.com/Rona1do/PromptNook.git
cd PromptNook
npm ci
npm run tauri:dev
```

只运行浏览器内存演示版：

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

## 许可证

本项目采用 [MIT License](LICENSE)。
