# Contributing to M4KE

欢迎改进 M4KE。请把“软件行为正确”“数值 / 几何检查通过”和“实物可工作”分开报告。当前仍是原型；小车基准尚未通过，不要把示例或测试桩包装为已完成的制造验证。

## 先确认修改范围

1. 阅读 [架构](docs/architecture.md) 和 [目录指南](docs/project-layout.md)。选择一个可复现的问题，写明预期行为及验证方式。
2. 在独立分支或工作副本开发。共享工作区先检查其他人的未提交改动，不运行清理 / 重置来消除未知文件。
3. 队友维护的模型库、视频和概念目录默认只读。需要改变源模型、比例、接口或许可证时，先与所有者协调；不要把批量格式化跨到这些目录。
4. 新功能不能绕过固定设计要求、来源哈希、FAIL / UNKNOWN、打印禁用或本地推理边界。

## 开发环境

使用 Node.js 22.12+ 和 `package-lock.json`；执行 `npm ci`，不要为普通改动重新生成依赖版本。完整 DGX / Python 3.12 / CadQuery 安装见 [部署文档](docs/submission/DEPLOYMENT.md)。

```sh
npm ci
npm run check:source
npm start
# 另一终端：
npm run dev
```

源码环境没有供应商几何时，`test:source` 会明确列出延后的套件。恢复正确组件资料后运行 `npm run check`；不能把缩减的源码检查称为完整验收。

## 代码约定

- 前端使用 Vue 3 Composition API 和 Pinia；只保留一个产品入口。组件内不复制服务端工程规则，Three.js 控制器负责资源生命周期，面板共享选择 / 显隐状态。

- `.mjs` 使用 ES modules 和显式相对文件扩展名；浏览器代码在 `src/`，服务端在 `server/`，共享契约不得导入服务端运行时。
- 命名体现业务职责。添加新模块前判断它是否真正形成边界，不以文件数或抽象层数衡量质量。
- 遵循 [.editorconfig](.editorconfig)：UTF-8、统一换行；JS / TS / JSON 两空格，Python 四空格。不要顺带格式化无关旧文件。
- 先用契约校验外部数据。模型响应、源模型元数据和导入文件是数据，不能成为 shell、Python 或额外权限。
- 计算输入保留单位、来源和假设。未测量的公差、制造可行性和真实性能应继续 UNKNOWN；不要为了通过测试修改目标值。
- 预期失败有明确错误类型 / 状态；不吞掉错误，不用默认零值掩盖缺失数据。重试有次数和时间上限。
- 按模块文件位置或明确传入的仓库根解析资源，不依赖调用者的当前目录。路径大小写应能在 Linux 上正确运行。
- 密钥、设备地址、个人路径、日志和生成数据不得进入公共代码。导入依赖和外部资产必须记录来源、用途及许可。

仓库提供语法、导入路径与类型检查，**不声称所有历史代码已通过统一 lint / formatter**。样式治理应与行为修改分开提交。

## 测试要求

先添加能够暴露问题的测试，再做最小修复。保留失败原因，避免只断言“没有抛异常”。

```sh
npm run check:syntax
npm run typecheck
npm test                    # 需要相应本地组件资料的完整 Node 套件
npm run build
python3 tests/submission_package_test.py

# DGX 上安装了原生依赖后，按影响范围执行：
.venv-cad/bin/python tests/cad_worker_test.py --kernel
.venv-cad/bin/python tests/catalog_mates_test.py --kernel
.venv-cad/bin/python tests/illustrate_test.py
python3 tests/catalog_reconstruct_test.py
python3 -m unittest discover -s firmware/sound-car -p 'test_*.py'
```

修改界面时，执行 `npm run test:e2e`：它启动独立 Vite 服务并使用模拟接口，不连接 DGX 或调用 Qwen。先准备 Playwright Chromium（`npx playwright install chromium`），或通过 `M4KE_BROWSER_EXECUTABLE` 指定已有 Chrome / Chromium 的完整路径；测试不会自行下载浏览器。用 `M4KE_TEST_OUTPUT` 指定新的结果目录，避免覆盖此前的截图与记录。

还应人工检查布局、键盘操作、错误状态、语言切换和减少动态效果。其他使用真实服务的浏览器 / Qwen 测试可能创建项目、消耗 GPU 资源；先检查脚本所需配置，不把生产服务当作匿名测试环境。

记录时区、代码 / 制品版本、执行命令、通过 / 失败 / 跳过及缺失能力。测试桩证明软件合同，真实模型测试证明该次生成，原生 CAD 证明该次几何检查，实物测试证明被测硬件行为；它们不可互相替代。

## 提交与评审清单

- [ ] 一个清晰目的，未覆盖其他人的工作或顺带修改源模型。
- [ ] 测试包含正常与错误路径；必要时覆盖超时、取消、重复操作和数据篡改。
- [ ] 文档、入口、打包白名单和测试夹具随接口变更同步更新。
- [ ] 没有设备凭据、个人环境、未经许可的二进制或私人模型库。
- [ ] 明确记录剩余限制及哪些检查没有执行。
- [ ] 新的依赖 / 资产保留自己的许可证与来源。

发布前使用 [源码包检查流程](docs/submission/DEPLOYMENT.md)，审核实际归档内容；`.gitignore` 不是发布白名单，也不能从已经提交的历史中移除秘密。当前整理不授权发布仓库或外部服务。
