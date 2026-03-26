# NanoClaw

这个分支已经从 Claude 时代的实现迁移到 Codex 原生运行时。

最新、最准确的说明请查看英文版 [README.md](README.md)。中文版这里只保留当前状态摘要。

## 当前保留的能力

- 基于 Codex CLI 的容器内代理执行
- 基于 `AGENTS.md` 的指令与记忆
- 按群组隔离的会话状态
- 调度器、SQLite、IPC 与容器隔离

## 已移除的旧机制

- Claude Agent SDK
- `.claude` 状态目录
- Claude Remote Control
- 旧的宿主机技能安装流程

具体的启动、开发和架构说明请以英文 README 为准。
