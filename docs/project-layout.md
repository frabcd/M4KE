# 目录与文件指南

## 为什么存在多个 `.mjs`

`.mjs` 是 Node / 浏览器可使用的 JavaScript ES 模块。设计、接线、打印和项目存储承担不同职责，因此保留独立模块；它们不是重复模型文件。此次整理把后端模块移到 `server/`，而不是把所有代码拼成一个大文件或创建多层空壳。

## 公开源码结构

| 路径 | 内容与修改边界 |
| --- | --- |
| `src/` | Vue Composition API / TypeScript、Pinia 状态和 Three.js 控制器 |
| `server/index.mjs` | Node 入口；使用 `npm start` 启动 |
| `server/studio-*.mjs` | Qwen 工作流、契约、项目、组件库、接线、检查与集成 |
| `shared/car-contract.mjs` | 前后端共享的纯数据契约；不是一个预设计的小车 |
| `engineering/` | 计算、参考硬件与明确标识的套件；参考套件不能替代新 Qwen 验收 |
| `cad/` | 原生建模、源几何 / 轴孔检查、插图和依赖锁 |
| `skills/` | 运行时技能与来源说明；不是模型权重 |
| `catalog/` | 可审核的元数据、接口证据及单独安装的组件资料 |
| `components/` | 参考组件声明 |
| `procurement/` | 离线报价 / 快照导入代码 |
| `printing/` | 切片适配器和只读打印机状态代码 |
| `firmware/` | 输出默认禁用的调试模板、控制测试 |
| `scripts/` | 安装、恢复、源码质量、打包和可重复基准脚本 |
| `tests/` | 单元、服务集成、浏览器及原生检查 |
| `docs/` | 导航、架构、安装、能力边界及贡献指南 |

根目录只保留项目入口、许可、依赖锁、构建配置和读我文件等高可见内容。已有私有工作区可能另有旧工具或队友文件；不为追求整齐而删除它们。

## 本地保留、默认不发布

| 路径 / 类型 | 处理方式 |
| --- | --- |
| `data/`、`test-results/`、日志 | 用户项目、模型响应和证据；保留本地，不能盲目上传 |
| `node_modules/`、`dist/`、`.venv-cad/`、`.setup/`、缓存 | 由锁文件 / 安装过程生成，不作为源码提交 |
| `database/model-library/` | 队友负责的源模型 / 数据库；未经协商不移动、改比例或删除 |
| `m4ke-video/`、`iphone18-concept/`、录制资料 | 独立协作工作；不属于此次目录重构范围 |
| `deploy/`、私人连接脚本 | 当前设备的运维资料；公共部署使用 `scripts/` 与部署指南 |
| `TEAM_COORDINATION.txt`、`docs/team/`、`docs/coordination/` | 团队沟通与交接；不当作公共产品文档 |
| `docs/history/`、`docs/checkpoints/`、`docs/inputs/` | 历史 / 用户原始输入，私有保留，不批量发布 |
| `docs/submission/artifacts/` | 不可变审查归档与记录；新版本生成新文件，不覆盖旧证据 |
| 供应商 CAD、权重、切片器二进制 | 来源与许可单独审查，安装后使用，不随源码自动再分发 |

`.gitignore` 只减少误加入，不删除文件、不改变运行时加载，也不是秘密扫描器。已追踪文件不受忽略规则保护。发布使用白名单源码包和逐项审查，而不是直接上传整个工作目录。

## 本次迁移约定

```text
server.mjs          → server/index.mjs
studio-*.mjs        → server/studio-*.mjs
car-contract.mjs    → shared/car-contract.mjs
```

- 没有保留根目录转发壳；测试、脚本、构建和打包必须使用新路径。
- `src/`、`cad/`、`engineering/`、组件资料和运行时数据位置不变。
- `npm start` 仍是稳定启动方式；引用旧入口的私有服务配置需同步审查，不能只移动源码就认为线上已更新。
- 旧 README 原样备份在私有 `docs/history/` 中；当前 README 不再堆叠多个互相覆盖的历史状态。
- `npm run check:syntax` 检查静态导入和目录边界；`npm run check:source` / `npm run check` 分别验证无资产源码与完整资料环境。

后续改名应是独立、可回滚的改动：先建立引用清单，再同步入口和资源路径，执行测试及源码包检查，最后决定部署。不要将重新排列目录与改变工程结论混为一项修改。

## Vue 3 工作台

- `src/App.vue`：五阶段壳、导航和布局，不承载物理计算。
- `src/components/`：大纲、属性、问答、验证、电气、交付、打印和来源库面板。
- `src/studio/`：集中式 Pinia 状态、API、类型和纯展示校验。
- `src/viewport/`：框架无关 Three.js 生命周期、拾取、显隐、相机和资源释放。
- `src/studio-mesh-cache.mjs`：原生 STL 哈希校验与限量缓存。

旧 React 产品入口与依赖已移除，不维护双框架；历史原样源码可从本地 `backup/pre-vue3-*` 标签恢复。纯 `domain.ts` / `instructions.ts` 暂保留已有回归契约，不是第二套产品入口。
