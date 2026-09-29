# M4KE 文档导航

从 [项目首页](../README.md) 开始。本目录区分当前使用说明、架构契约和历史证据；旧检查记录只适用于记录中的版本。

## 工作台

- [Vue 五阶段、选件 AI、Blender 快捷键与回滚](vue-workspace.md)

## 安装与开发

- [DGX 安装、离线缓存和源组件恢复](submission/DEPLOYMENT.md)
- [目录与文件指南](project-layout.md)
- [架构、运行流程与证据边界](architecture.md)
- [贡献指南](../CONTRIBUTING.md)
- [安全政策](../SECURITY.md)

## 组件与工具

- [模型设计 / 验证技能接入](skill-integration-handoff.md)
- [电气工作流与接线输出](electrical-workflow.md)
- [供电与接线限制](car-power-and-wiring.md)
- [组件源资料重建](source-reconstruction.md)
- [离线供应商与价格快照](procurement-offline.md)
- [供应商适配器的实际能力](coop4-integration.md)
- [可选打印机只读状态](printer-lan.md)

## 源码审查与比赛提交

- [本次公开源码发布与检查](submission/PUBLIC-RELEASE.md)
- [发布检查表](submission/competition-release-checklist.md)
- [源码清单](submission/INVENTORY.md)
- [验证记录与边界](submission/VALIDATION.md)
- [原始代码和第三方许可](submission/LICENSE-NOTES.md)
- [源数据漂移说明](submission/SOURCE-DRIFT-REVIEW.md)

## 历史与私人资料

现有工作目录还可能包含团队交接、部署设备信息、输入文档、原始运行记录和 `history/`。这些资料保留原样，但不自动包含在公开源码中。新的测试结果应记录自己的代码 / 制品版本，不能覆盖历史失败，或把旧包的验证状态赋给当前目录。

Vue 迁移的分层测试结果见 [验收记录](vue-validation.md)。
