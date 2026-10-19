EXAMPLES = {
    'two-sum': {
        'title': '两数之和', 'difficulty': '简单', 'tags': ['数组', '哈希表'],
        'method': 'twoSum',
        'cases': [
            {'input': {'nums': [2, 7, 11, 15], 'target': 9}, 'output': [0, 1]},
            {'input': {'nums': [3, 2, 4], 'target': 6}, 'output': [1, 2]},
            {'input': {'nums': [3, 3], 'target': 6}, 'output': [0, 1]},
        ],
        'content': '给定一个整数数组 nums 和一个整数目标值 target，请找出和为 target 的两个整数，并返回它们的数组下标。\n\n你可以假设每种输入只会对应一个答案，不能重复使用同一个元素。\n\n示例：nums = [2, 7, 11, 15], target = 9\n输出：[0, 1]\n解释：nums[0] + nums[1] = 9。\n\n约束：2 <= nums.length <= 10^4；整数可能为负数。\n进阶：尝试设计时间复杂度小于 O(n²) 的算法。',
        'steps': [
            '### 先把问题说清楚\n我们要找的是两个数的**下标**，不是数本身。同一个位置不能用两次。\n\n看 `[2, 7, 11, 15]`，目标是 `9`：如果先选 `2`，还需要什么数？\n\n**先试着回答：还差多少，以及你会怎样找它？**',
            '### 从最直接的方法开始\n固定第一个数，再遍历后面的数，检查两者之和。这个方法是正确的。\n\n但最多要比较约 `n(n-1)/2` 对数，时间复杂度是 **O(n²)**。\n\n当遍历到 `nums[i]`，我们只关心一个值：`target - nums[i]`。**能不能快速知道这个值之前出现过？**',
            '### 用一张「见过的数」表\n让哈希表保存 **数值 → 下标**。每次先查找缺少的数，再把当前数放进表里。\n\n以 `[2, 7]`、目标 `9` 为例：\n- 遇到 2：查 7，没找到；记下 `2 → 0`。\n- 遇到 7：查 2，找到下标 0；返回 `[0, 1]`。\n\n**为什么必须先查找，再插入？** 想想 `[3, 3]`、目标 `6`，这样可以避免重复使用当前元素。',
            '### 把思路翻译成步骤\n```text\n创建一个空哈希表 seen\n遍历每个下标 i\n    need = target - nums[i]\n    如果 seen 中有 need：返回 [seen[need], i]\n    保存 seen[nums[i]] = i\n```\n\nC++ 可以用 `unordered_map<int, int>`；Python 可以用 `dict`。\n\n现在试着写到右侧编辑器里。特别留意**先查询，再保存**的顺序。',
        ],
        'cpp': '#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int, int> seen;\n        for (int i = 0; i < (int)nums.size(); ++i) {\n            int need = target - nums[i];\n            if (seen.count(need)) return {seen[need], i};\n            seen[nums[i]] = i;\n        }\n        return {};\n    }\n};',
        'python': 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        seen = {}\n        for i, value in enumerate(nums):\n            need = target - value\n            if need in seen:\n                return [seen[need], i]\n            seen[value] = i\n        return []',
        'complexity': '时间复杂度：平均 O(n)；空间复杂度：O(n)。哈希表查找平均 O(1)，最坏情况下可能退化。',
        'review': '识别线索：寻找配对，并且已经知道另一项应该是什么。把「寻找另一项」转化为「查询历史记录」。边界例子：重复值 `[3,3]`、负数、答案位于数组末尾。',
    },
    'valid-parentheses': {
        'title': '有效的括号', 'difficulty': '简单', 'tags': ['字符串', '栈'],
        'method': 'isValid',
        'cases': [
            {'input': {'s': '()[]{}'}, 'output': True},
            {'input': {'s': '([)]'}, 'output': False},
            {'input': {'s': '{[]}'}, 'output': True},
            {'input': {'s': '('}, 'output': False},
        ],
        'content': '给定一个只包含 ( ) { } [ ] 的字符串 s，判断字符串是否有效。\n\n有效字符串需要满足：左括号必须用相同类型的右括号闭合；左括号必须以正确顺序闭合；每个右括号都有对应的左括号。\n\n示例：s = "()[]{}"，输出 true。\n示例：s = "([)]"，输出 false。\n\n约束：1 <= s.length <= 10^4。',
        'steps': ['### 先观察配对顺序\n对 `([])`，最后出现的左括号 `[` 必须最先闭合。\n\n**如果只统计左右括号的数量，能区分 `([])` 和 `([)]` 吗？**', '### 找到需要记住的信息\n扫描字符串时，需要记住还没有闭合的左括号，而且最晚出现的要先处理。\n\n这正好对应**后进先出**。想一想，哪一种数据结构支持这个顺序？', '### 使用栈\n遇到左括号就入栈；遇到右括号，检查栈顶是否是对应的左括号。\n\n栈为空或者类型不匹配时，立即返回 false。全部扫描结束后，栈也必须为空。\n\n试着手动追踪 `([)]` 的栈变化。', '### 写成伪代码\n```text\n创建空栈\n遍历字符\n    左括号：入栈\n    右括号：检查栈顶配对，失败则返回 false；成功则弹出\n返回栈是否为空\n```\n\nC++ 用 `stack<char>`；Python 用列表的 `append` / `pop`。'],
        'cpp': '#include <string>\n#include <stack>\nusing namespace std;\n\nclass Solution {\npublic:\n    bool isValid(string s) {\n        stack<char> st;\n        for (char c : s) {\n            if (c == \'(\' || c == \'[\' || c == \'{\') st.push(c);\n            else {\n                if (st.empty()) return false;\n                char expected = c == \')\' ? \'(\' : c == \']\' ? \'[\' : \'{\';\n                if (st.top() != expected) return false;\n                st.pop();\n            }\n        }\n        return st.empty();\n    }\n};',
        'python': 'class Solution:\n    def isValid(self, s: str) -> bool:\n        stack = []\n        pairs = {\")\": \"(\", \"]\": \"[\", \"}\": \"{\"}\n        for char in s:\n            if char in \"([{\":\n                stack.append(char)\n            elif not stack or stack.pop() != pairs[char]:\n                return False\n        return not stack',
        'complexity': '时间复杂度 O(n)，空间复杂度 O(n)。',
        'review': '识别线索：嵌套结构、最近出现的对象先完成。边界例子：单个右括号、剩余左括号、交叉配对。',
    },
    'binary-search': {
        'title': '二分查找', 'difficulty': '简单', 'tags': ['数组', '二分查找'],
        'method': 'search',
        'cases': [
            {'input': {'nums': [-1, 0, 3, 5, 9, 12], 'target': 9}, 'output': 4},
            {'input': {'nums': [-1, 0, 3, 5, 9, 12], 'target': 2}, 'output': -1},
            {'input': {'nums': [5], 'target': 5}, 'output': 0},
        ],
        'content': '给定升序排列的整数数组 nums 和目标值 target，如果目标存在，返回下标，否则返回 -1。要求时间复杂度 O(log n)。\n\n示例：nums = [-1,0,3,5,9,12], target = 9\n输出：4\n\n约束：1 <= nums.length <= 10^4；所有元素互不相同。',
        'steps': ['### 利用题目给出的条件\n数组已经有序。假如中间的数比目标小，目标还可能在它的左侧吗？\n\n**先解释为什么可以排除一半区间。**', '### 保留可能有答案的范围\n用 `left` 和 `right` 表示一个闭区间。检查中间位置 `mid`：\n- 值太小，去右半边。\n- 值太大，去左半边。\n- 相等，返回下标。', '### 边界是这道题的重点\n闭区间用 `left <= right` 作为循环条件。\n\n排除已经检查的 mid：`left = mid + 1` 或 `right = mid - 1`。\n\n如果忘记加减 1，只有一个元素时会发生什么？', '### 伪代码\n```text\nleft = 0, right = n - 1\n当 left <= right\n    mid = left + (right - left) / 2 的整数部分\n    相等则返回 mid\n    太小则 left = mid + 1\n    太大则 right = mid - 1\n返回 -1\n```\n\n先用单元素数组手动检查边界。'],
        'cpp': '#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    int search(vector<int>& nums, int target) {\n        int left = 0, right = (int)nums.size() - 1;\n        while (left <= right) {\n            int mid = left + (right - left) / 2;\n            if (nums[mid] == target) return mid;\n            if (nums[mid] < target) left = mid + 1;\n            else right = mid - 1;\n        }\n        return -1;\n    }\n};',
        'python': 'class Solution:\n    def search(self, nums: list[int], target: int) -> int:\n        left, right = 0, len(nums) - 1\n        while left <= right:\n            mid = left + (right - left) // 2\n            if nums[mid] == target:\n                return mid\n            if nums[mid] < target:\n                left = mid + 1\n            else:\n                right = mid - 1\n        return -1',
        'complexity': '时间复杂度 O(log n)，空间复杂度 O(1)。',
        'review': '识别线索：有序、可以根据比较排除一半候选。边界例子：单元素、目标不存在、目标在两端。明确使用闭区间，保持边界约定一致。',
    },
}

def starter(language, example_id=None):
    if example_id == 'two-sum':
        return 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        // 从你的思路开始\n        \n    }\n};' if language == 'cpp' else 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        # 从你的思路开始\n        pass'
    return '// 在这里写下你的 C++ 思路\n#include <bits/stdc++.h>\nusing namespace std;\n\nclass Solution {\npublic:\n    \n};' if language == 'cpp' else '# 在这里写下你的 Python 思路\nclass Solution:\n    pass'
