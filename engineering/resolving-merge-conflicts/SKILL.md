---
name: resolving-merge-conflicts
description: "当需要解决一个进行中的 git merge/rebase 冲突时使用。（Use when you need to resolve an in-progress git merge/rebase conflict.）"
---

1. **看清当前状态**。检查 git 历史和冲突中的文件。

2. **为每个冲突找到一手来源**。深入理解每一处改动为什么做出、原本的意图是什么。读提交信息，查 PR，查原始 issue/工单。

3. **逐块（hunk）解决。** 可能时**保留双方意图**。当两者不兼容时，选与本次 merge 既定目标一致的那一个，并记下取舍。**不要**发明新行为。永远解决；**绝不 `--abort`**。

4. 找出项目的**自动化检查**并运行——通常是类型检查，然后测试，然后格式化。修掉 merge 弄坏的任何东西。

5. **完成这次 merge/rebase。** 把所有内容暂存并提交。如果是 rebase，继续 rebase 流程直到所有提交都完成变基。
