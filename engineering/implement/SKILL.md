---
name: implement
description: "按一份规格或一组工单实现一块工作。（Implement a piece of work based on a spec or set of tickets.）"
disable-model-invocation: true
---

实现用户在规格或工单里描述的工作。

尽可能在**预先约定的接缝**处使用 `/tdd`。

定期跑类型检查，定期跑单个测试文件，最后完整跑一遍整个测试套件。

做完之后，用 `/code-review` 审查这项工作。

把工作提交到当前分支。
