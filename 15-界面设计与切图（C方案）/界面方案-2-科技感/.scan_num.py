import re, os, collections, json

ROOT = r'D:\工作环境\批量文件改名'
EXTS = ('.md', '.html', '.ts', '.vue', '.json', '.js')
SKIP_DIRS = {'node_modules', 'out', 'dist', '.git', 'artifacts', 'coverage', '.vite'}
# 总规划文件里的「编号用量」文字会污染上限 —— 必须先排除
EXCLUDE_FILES = {'P3-2-8批范围澄清与交付总规划.md'}

pat = re.compile(r'\b(EL|IX|TC|DEC|EX|ST|SCR|ADR|MOD|R|F)-(\d{2,3})\b')
agg = collections.defaultdict(set)
where = collections.defaultdict(list)

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if not fn.endswith(EXTS):
            continue
        if fn in EXCLUDE_FILES:
            continue
        p = os.path.join(dirpath, fn)
        try:
            t = open(p, encoding='utf-8', errors='replace').read()
        except Exception:
            continue
        for m in pat.finditer(t):
            pre, num = m.group(1), int(m.group(2))
            agg[pre].add(num)
            where[(pre, num)].append(os.path.relpath(p, ROOT))

lines = []
lines.append('=== 全量编号占用（已排除总规划文件；已跳过 node_modules/out/dist/.git/artifacts）===')
for pre in sorted(agg):
    nums = sorted(agg[pre])
    mx = nums[-1]
    files_for_max = sorted(set(where[(pre, mx)]))[:4]
    lines.append('%-4s max=%-4d 共占用 %2d 个 ｜ 号: %s' % (pre, mx, len(nums), ','.join(str(n) for n in nums)))
    lines.append('     max 出现在: %s' % ' ; '.join(files_for_max))
    # 找跳档（可能是假上限，如 EL-900 是原型 DOM id）
    if len(nums) >= 3:
        gaps = [(nums[i], nums[i+1]) for i in range(len(nums)-1) if nums[i+1] - nums[i] > 20]
        for a, b in gaps:
            f = sorted(set(where[(pre, b)]))[:3]
            lines.append('     ⚠ 跳档 %d → %d（%s 出现在 %s）' % (a, b, pre + '-' + str(b), ' ; '.join(f)))

out = '\n'.join(lines)
open(r'D:\工作环境\批量文件改名\界面方案-2-科技感\.num-scan.txt', 'w', encoding='utf-8').write(out)
print(out)
