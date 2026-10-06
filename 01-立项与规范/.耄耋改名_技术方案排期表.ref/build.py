# -*- coding: utf-8 -*-
"""
耄耋改名 · 技术方案实施排期表
原型：计划型（主）+ 进度型 + 统计型
配色：清新绿（项目 / 任务 / 进度）
"""
import datetime as dt

try:
    import openpyxl
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "openpyxl>=3.1.0"])
    import openpyxl

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, FormulaRule


# ── 颜色：CSS #RRGGBB → openpyxl ARGB（一次性转换，后续只用常量） ──
def xl_color(css_hex: str) -> str:
    value = css_hex.removeprefix("#").upper()
    if len(value) != 6:
        raise ValueError(f"Expected #RRGGBB, got: {css_hex}")
    return "FF" + value


XL_HEADER_BG = xl_color("#70AD47")
XL_HEADER_FG = xl_color("#FFFFFF")
XL_INPUT_BG = xl_color("#E2EFDA")
XL_CALC_BG = xl_color("#F2F2F2")
XL_TOTAL_BG = xl_color("#548235")
XL_TOTAL_FG = xl_color("#FFFFFF")
XL_BORDER = xl_color("#BFBFBF")
XL_TITLE_FG = xl_color("#2F5597")
XL_NOTE_FG = xl_color("#6B6B6B")
XL_OK_BG = xl_color("#C6EFCE")
XL_OK_FG = xl_color("#006100")
XL_WARN_BG = xl_color("#FFEB9C")
XL_WARN_FG = xl_color("#9C6500")
XL_BAD_BG = xl_color("#FFC7CE")
XL_BAD_FG = xl_color("#9C0006")

FONT = "微软雅黑"
thin = Side(style="thin", color=XL_BORDER)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

F_TITLE = Font(name=FONT, size=13, bold=True, color=XL_TITLE_FG)
F_NOTE = Font(name=FONT, size=9, color=XL_NOTE_FG)
F_HEAD = Font(name=FONT, size=10, bold=True, color=XL_HEADER_FG)
F_BODY = Font(name=FONT, size=10)
F_BODY_W = Font(name=FONT, size=10, color=XL_HEADER_FG, bold=True)
F_BOLD = Font(name=FONT, size=10, bold=True)

FILL_HEAD = PatternFill("solid", fgColor=XL_HEADER_BG)
FILL_INPUT = PatternFill("solid", fgColor=XL_INPUT_BG)
FILL_CALC = PatternFill("solid", fgColor=XL_CALC_BG)
FILL_TOTAL = PatternFill("solid", fgColor=XL_TOTAL_BG)

AL_C = Alignment(horizontal="center", vertical="center")
AL_L = Alignment(horizontal="left", vertical="center")
AL_LW = Alignment(horizontal="left", vertical="center", wrap_text=True)
AL_CW = Alignment(horizontal="center", vertical="center", wrap_text=True)
AL_R = Alignment(horizontal="right", vertical="center")

FMT_DAY = "0.0"
FMT_PCT = "0.0%"
FMT_DATE = "yyyy-mm-dd"
FMT_INT = "0"

# ── 锚点（先定锚点，再由锚点推导全部公式坐标） ──
# 任务明细：第1行标题、第2行口径、第3行表头、第4~48行数据（45 项任务）
D_HEAD, D_FIRST, D_LAST = 3, 4, 48
# 里程碑总览：第1行标题、第2行口径、第3行表头、第4~8行数据、第9行合计；KPI 区第11~16行
M_HEAD, M_FIRST, M_LAST, M_TOTAL = 3, 4, 8, 9
# 验收用例对照：第1行标题、第2行表头、第3~20行数据
T_HEAD, T_FIRST, T_LAST = 2, 3, 20

START_DATE = dt.date(2026, 9, 14)
SH_ASSUME = "假设与口径"
P_START = f"{SH_ASSUME}!$B$4"      # 起始日期
P_RATIO = f"{SH_ASSUME}!$B$7"      # 日历天/人日
P_BUFFER = f"{SH_ASSUME}!$B$8"     # 缓冲系数
SH_DETAIL = "任务明细"
DE = f"{SH_DETAIL}!$E${D_FIRST}:$E${D_LAST}"   # 人日
DB = f"{SH_DETAIL}!$B${D_FIRST}:$B${D_LAST}"   # 里程碑
DH = f"{SH_DETAIL}!$H${D_FIRST}:$H${D_LAST}"   # 状态


# ══════════════════════════════════════════════════════════════════
# 数据
# ══════════════════════════════════════════════════════════════════
MILESTONES = [
    ("MS-1", "引擎先行", "规则引擎 + 冲突检测 + 扩展名保护 + 两阶段改名 + 存储与撤销服务；命令行可验证", "—",
     "可命令行验证的改名内核；引擎单测覆盖率 ≥ 90%"),
    ("MS-2", "界面成型", "SCR-01 主窗口 UI + 文件列表 + 规则区 + 实时预览（Worker）+ 虚拟滚动", "MS-1",
     "能用的界面（无形象），可完成一次完整改名"),
    ("MS-3", "注入灵魂", "耄耋 5 状态动画 + ST-03 咬名字 + 音效 + 微动效 + 减少动画开关", "MS-2",
     "有灵魂的 UI；动作歧义自查通过"),
    ("MS-4", "安全闭环", "拖拽（P0）+ 系统对话框 + 执行/取消/回滚 + 三个弹窗 + 历史页 + 异常态全覆盖", "MS-2",
     "安全完整版；TC-07 冲突不覆盖可验证"),
    ("MS-5", "打包发布", "electron-builder + NSIS + 体积优化 + 全量回归 + 真机验证 + 开源整理", "MS-3 / MS-4",
     "可安装的 exe（安装包实测体积已记录）"),
]

# (编号, 里程碑, 任务名, 所属模块, 人日, 依赖, 验收标志, 备注)
TASKS = [
    # ── MS-1 引擎先行 ──
    ("T-1.1", "MS-1", "工程脚手架（electron-vite + TS + Vue3 + Pinia + Vitest + ESLint 依赖方向规则）", "基础设施", 1,
     "—", "npm run dev 可启动；反向 import 被 lint 拦住", "tsconfig 开 strict"),
    ("T-1.2", "MS-1", "共享层类型 / 常量 / 通道名 / 错误码", "shared", 0.5,
     "T-1.1", "类型编译通过；通道名与接口文档 §3 一致", ""),
    ("T-1.3", "MS-1", "路径工具 + 名称拆分与扩展名保护", "shared", 1,
     "T-1.2", "单测 U-05 / U-06；EX-07 全部细则逐条覆盖", "含 .gitignore / 结尾点 / 全角点边界"),
    ("T-1.4", "MS-1", "规则引擎三模式 + 变量去重 + 组合公式 A/B/C/D", "shared", 2,
     "T-1.3", "单测 U-07 / U-08；TC-03 / TC-04 / TC-06", "公式以 PRD §4.2.5 表格为准"),
    ("T-1.5", "MS-1", "差异高亮算法（最长公共前缀 / 后缀）", "shared", 0.5,
     "T-1.3", "单测 U-14 覆盖全部边界情形", ""),
    ("T-1.6", "MS-1", "校验器（非法字符 / 保留名 / 结尾点 / 超长 / 空名）", "shared", 0.5,
     "T-1.3", "单测 U-09 / U-10；TC-13 / TC-14", "保留名检查为本方案新增"),
    ("T-1.7", "MS-1", "冲突检测（批次内 + 磁盘 + case-only + 快照剔除源名称）", "shared", 1.5,
     "T-1.4", "单测 U-02 / U-04 / U-11 / U-15；TC-07", "最高风险模块，必须写透"),
    ("T-1.8", "MS-1", "两阶段改名执行器（safeRename / 回滚 / 取消）", "主进程", 2.5,
     "T-1.7", "单测 U-01 / U-03；目标已存在时文件字节不变", "ESLint 禁止裸 fs.rename"),
    ("T-1.9", "MS-1", "存储服务（原子写 / FIFO 淘汰 / 损坏恢复 / 写入队列）", "主进程", 1.5,
     "T-1.2", "单测 U-16（21 次改写后仅留 20 条）；模拟中断不损坏原文件", ""),
    ("T-1.10", "MS-1", "撤销服务（倒序 / 部分失败跳过 / 全部撤销）", "主进程", 1,
     "T-1.9", "单测 U-12 / U-13；TC-09 / TC-11", ""),
    ("T-1.11", "MS-1", "CLI 验证脚本 + 引擎单测补齐", "测试", 1,
     "T-1.4 ~ T-1.10", "覆盖率 ≥ 90%；1000 项预览 < 200ms", "MS-1 的核心交付物"),
    # ── MS-2 界面成型 ──
    ("T-2.1", "MS-2", "设计令牌落地（tokens.css / tokens.ts）", "渲染层", 0.5,
     "T-1.1", "色值只出现在 tokens.css；间距全在 4px 台阶", ""),
    ("T-2.2", "MS-2", "窗口外壳与自绘标题栏（三按钮 + 拖拽区 + 尺寸记忆）", "渲染层 / 主进程", 2,
     "T-2.1", "TC-17；恢复位置时窗口必落在可见屏幕内", "userData 目录名改为英文"),
    ("T-2.3", "MS-2", "左栏形象区占位 + 操作区三按钮", "渲染层", 1,
     "T-2.1", "三按钮样式符合设计规范 §4.1", ""),
    ("T-2.4", "MS-2", "文件列表（行渲染 / 计数 / 全选 / 行内删除 / 空态）", "渲染层", 2,
     "T-2.3", "EL-030 ~ EL-037 全部元素与状态", ""),
    ("T-2.5", "MS-2", "差异高亮渲染（DiffText 组件）", "渲染层", 1,
     "T-1.5 / T-2.4", "TC-03；变化片段橘色高亮 + 原片段删除线", ""),
    ("T-2.6", "MS-2", "规则区（页签 + 三模式表单 + 联动置灰）", "渲染层", 2.5,
     "T-2.3", "EL-040 ~ EL-055；规则化模式下隐藏 EL-044", ""),
    ("T-2.7", "MS-2", "预览 Worker 接入 + 200ms 防抖 + 过期结果丢弃", "渲染层", 1.5,
     "T-1.4 / T-2.6", "1000 项预览 ≤ 200ms；快速连打 20 字不闪动", ""),
    ("T-2.8", "MS-2", "虚拟滚动（> 500 行，固定行高 36px）", "渲染层", 1.5,
     "T-2.4", "10000 项滚动不掉帧；全选基于 id 而非 DOM 索引", ""),
    ("T-2.9", "MS-2", "状态栏（状态点 / 文案规则 / 进度条）", "渲染层", 1,
     "T-2.4", "交互说明 §11.2 全部文案分支命中", ""),
    ("T-2.10", "MS-2", "按钮状态矩阵（开始改名置灰逻辑）", "渲染层", 0.5,
     "T-2.7", "EX-11 / EX-12 置灰正确", ""),
    ("T-2.11", "MS-2", "键盘与无障碍（快捷键 + 焦点顺序 + 减少动画开关）", "渲染层", 1,
     "T-2.2", "交互说明 §9 全部按键生效", ""),
    # ── MS-3 注入灵魂 ──
    ("T-3.1", "MS-3", "形象资源接入（6 分组 + manifest.json 一键替换机制）", "渲染层", 1.5,
     "T-2.3", "换掉 cats/ 目录即可换形象，代码零改动", "形象仍为占位"),
    ("T-3.2", "MS-3", "状态机（优先级 / 会话约束 / 回落定时器清理）", "渲染层", 1.5,
     "T-3.1", "ST-03 不被 ST-02 抢占；无幽灵定时器", ""),
    ("T-3.3", "MS-3", "ST-01 / ST-02 / ST-04 / ST-05 动画", "渲染层", 2,
     "T-3.2", "四状态文案与动效符合设计规范 §6.2", ""),
    ("T-3.4", "MS-3", "ST-03 咬名字动画（卡片队列 + 8 关键点时序）", "渲染层", 3,
     "T-3.2", "交互说明 §7.3 时序逐点对齐；离开即停无残影", "工作量最大的一项"),
    ("T-3.5", "MS-3", "音效接入 + 开关", "渲染层", 0.5,
     "T-3.3", "成功「叮」/ 失败「噗」；开关即时生效", ""),
    ("T-3.6", "MS-3", "「动作不得有歧义」自查 + 非项目成员观看", "验收", 0.5,
     "T-3.4", "至少 1 位非项目成员确认无歧义", "PRD §4.6.3 硬约束"),
    # ── MS-4 安全闭环 ──
    ("T-4.1", "MS-4", "系统对话框通道（pickFiles / pickDirectory）", "主进程", 0.5,
     "T-2.2", "TC-02：文件夹只加本身，不递归内部文件", ""),
    ("T-4.2", "MS-4", "路径解析入列（resolvePaths + 目录快照 + stats 五项）", "主进程", 1.5,
     "T-4.1", "EX-08 / EX-09 / EX-13 计数正确", "symlink 指向目录时 isDir 判定正确"),
    ("T-4.3", "MS-4", "拖拽入列（计数蒙层 / 拒绝态 / 去重 / 落区高亮）", "渲染层", 1.5,
     "T-4.2", "TC-01；dragenter 计数归零才隐藏蒙层", ""),
    ("T-4.4", "MS-4", "执行流程接入（进度事件 + 取消 + 回滚 UI）", "渲染层 / 主进程", 2,
     "T-2.7 / T-1.8", "TC-15；取消后已改项全部回滚为原名", ""),
    ("T-4.5", "MS-4", "SCR-03 结果弹窗（摘要 / 示例 / 异常清单）", "渲染层", 1.5,
     "T-4.4", "异常清单 200 条截断并显示总数", "recordSaved=false 时必须明确警告"),
    ("T-4.6", "MS-4", "SCR-04 冲突弹窗 + 「自动加序号」联动", "渲染层", 1,
     "T-4.4", "TC-08；默认按钮为「先不改（推荐）」", ""),
    ("T-4.7", "MS-4", "SCR-05 二次确认（四类文案）", "渲染层", 1,
     "T-4.4", "设计规范 §5.4 四类文案逐条对上", ""),
    ("T-4.8", "MS-4", "SCR-02 历史页（两态卡片 + 单条撤销 + 全部撤销 + 清空历史）", "渲染层", 2,
     "T-1.10", "TC-09 / TC-10 / TC-11", "「清空历史」为新增；超上限淘汰须显式提示（DEC-09）"),
    ("T-4.9", "MS-4", "异常态全覆盖（EX-01 ~ EX-14 界面表现）", "渲染层", 1.5,
     "T-4.5", "文案全部取自 MD_ERROR_TEXT，无硬编码", ""),
    ("T-4.10", "MS-4", "IPC 契约测试（15 通道 · 正常与异常入参）", "测试", 1,
     "T-4.4", "每个通道正常 / 异常各一条用例", ""),
    # ── MS-5 打包发布 ──
    ("T-5.1", "MS-5", "electron-builder + NSIS 配置", "发布", 1,
     "T-4.4", "生成可安装 exe；userData 为英文目录名", ""),
    ("T-5.2", "MS-5", "图标 / 版本信息 / 安装向导文案", "发布", 0.5,
     "T-5.1", "安装向导中文文案与图标正确", ""),
    ("T-5.3", "MS-5", "体积优化（electronLanguages 等）+ 实测", "发布", 1,
     "T-5.1", "安装包实测体积已记录（力争 < 100MB）", "DEC-08：超标不阻断发布，仅记录数值"),
    ("T-5.4", "MS-5", "断网验证 + 构建产物网络调用全文搜索", "验收", 0.5,
     "T-5.3", "TC-16；产物中无 fetch / XHR / net 命中", ""),
    ("T-5.5", "MS-5", "全量回归 TC-01 ~ TC-18 + 1000 项性能实测", "验收", 2,
     "T-5.3", "18 条用例全过；1000 项改名 < 10 秒", ""),
    ("T-5.6", "MS-5", "真机验证（Windows 10 + Windows 11 各一轮）", "验收", 1,
     "T-5.5", "两套系统安装 / 改名 / 卸载均正常", ""),
    ("T-5.7", "MS-5", "开源仓库整理（README / 许可 / 隐私声明）", "发布", 1,
     "T-5.5", "README 含免责声明；隐私声明说明零收集", ""),
]

# (用例编号, 用例名称, 对应功能, 主要相关任务, 自动化, 备注)
CASES = [
    ("TC-01", "拖拽 / 按钮入列", "F-07 · F-01", "T-4.3 · T-4.2", "部分", "100 个文件全部入列，ST-02 触发"),
    ("TC-02", "添加文件夹不递归", "DEC-01", "T-4.1", "是", "只加入文件夹本身，不展开内部"),
    ("TC-03", "删除字符 + 变化高亮", "F-03 · F-08", "T-1.4 · T-2.5", "是", "abc广告.txt → abc.txt 且变化片段高亮"),
    ("TC-04", "替换字符", "F-04", "T-1.4", "是", "会议纪要-最终版 → 会议纪要-定稿"),
    ("TC-05", "扩展名保护", "EX-07", "T-1.3", "是", "删除「.」后扩展名前的点保留"),
    ("TC-06", "规则化组合（日期 + 序号 + 不保留原名）", "F-05", "T-1.4", "是", "公式以 PRD §4.2.5 表格为准"),
    ("TC-07", "冲突不覆盖", "F-16 · DEC-05", "T-1.7 · T-1.8", "是", "硬指标；磁盘文件必须零损失"),
    ("TC-08", "自动加序号", "F-16", "T-1.7 · T-4.6", "是", "生成 报告_1.docx / 报告_2.docx"),
    ("TC-09", "撤销单条", "F-09", "T-1.10 · T-4.8", "是", "文件名全部还原，该条转「已撤销」"),
    ("TC-10", "历史 20 条上限", "DEC-06", "T-1.9", "是", "与总条数上限的取舍见数据库设计 §4.4.4"),
    ("TC-11", "全部撤销", "F-09", "T-4.8", "是", "倒序逐条撤销，末了汇总提示"),
    ("TC-12", "占用文件失败", "EX-03", "T-1.8 · T-4.9", "否", "需人工用记事本占用文件后执行"),
    ("TC-13", "非法字符", "EX-01", "T-1.6", "是", "该行标红 + 原因「含非法字符」，不执行"),
    ("TC-14", "改后为空", "EX-04", "T-1.6", "是", "标红 + 「改完名字就空了」"),
    ("TC-15", "1000 项性能", "非功能", "T-4.4 · T-1.11", "部分", "改名 < 10 秒且界面不卡死"),
    ("TC-16", "离线验证", "隐私", "T-5.4", "否", "断网跑全流程 + 产物搜索双验证"),
    ("TC-17", "窗口状态记忆", "PRD §5.2", "T-2.2", "部分", "含「窗口跑出屏幕」防护校验"),
    ("TC-18", "空列表保护", "EX-11", "T-2.10", "是", "按钮置灰不可点"),
]

ASSUMPTIONS = [
    ("项目起始日期", START_DATE, "date", "第一个工作日（周一）。前一日为方案定稿日"),
    ("每天有效投入（小时）", 2.5, "num", "业余节奏：工作日晚上为主，周末可加量"),
    ("1 人日 = 小时", 3, "num", "人日定义口径；已按 AI 辅助开发的速度折算"),
    ("日历天 / 人日", None, "calc", "由「1 人日小时数 ÷ 每天有效投入」推导，不手填"),
    ("缓冲系数", 1.2, "num", "20% 缓冲，吸收调试、返工与踩坑时间"),
]


# ══════════════════════════════════════════════════════════════════
# 建表
# ══════════════════════════════════════════════════════════════════
wb = Workbook()

# ────────────────────────────────────────────────
# Sheet 1 · 里程碑总览（汇总，放最前）
# ────────────────────────────────────────────────
ws = wb.active
ws.title = "里程碑总览"
ws["A1"] = "耄耋改名 · 技术方案实施排期总览"
ws.merge_cells("A1:M1")
ws["A1"].font = F_TITLE
ws["A1"].alignment = AL_L
ws["A2"] = ("人日 = 3 小时有效投入；日历天 = 人日 × 比率（见「假设与口径」）；"
            "结束日期 = 起始日期 + 累计日历天 − 1；状态由「任务明细」自动汇总，不需手填")
ws.merge_cells("A2:M2")
ws["A2"].font = F_NOTE
ws["A2"].alignment = AL_L
ws.row_dimensions[1].height = 26
ws.row_dimensions[2].height = 18

m_head = ["里程碑", "阶段", "主要内容", "人日", "累计人日", "占总量比", "折算日历天",
          "开始日期", "结束日期", "依赖", "主要交付物", "状态", "工作量可视化"]
for i, name in enumerate(m_head, start=1):
    c = ws.cell(row=M_HEAD, column=i, value=name)
    c.font, c.fill, c.alignment, c.border = F_HEAD, FILL_HEAD, AL_CW, BORDER
ws.row_dimensions[M_HEAD].height = 30

for idx, (mid, phase, content, dep, deliver) in enumerate(MILESTONES):
    r = M_FIRST + idx
    ws.cell(row=r, column=1, value=mid).font = F_BOLD
    ws.cell(row=r, column=2, value=phase).font = F_BODY
    ws.cell(row=r, column=3, value=content).font = F_BODY
    ws.cell(row=r, column=4, value=f"=SUMIF({DB},$A{r},{DE})").number_format = FMT_DAY
    ws.cell(row=r, column=5, value=f"=SUM($D${M_FIRST}:D{r})").number_format = FMT_DAY
    ws.cell(row=r, column=6, value=f'=IF($E${M_TOTAL}=0,"",D{r}/$E${M_TOTAL})').number_format = FMT_PCT
    ws.cell(row=r, column=7, value=f"=ROUND(E{r}*{P_RATIO},0)").number_format = FMT_INT
    ws.cell(row=r, column=8,
            value=(f"={P_START}" if idx == 0 else f"=I{r-1}+1")).number_format = FMT_DATE
    ws.cell(row=r, column=9, value=f"={P_START}+$G{r}-1").number_format = FMT_DATE
    ws.cell(row=r, column=10, value=dep).font = F_BODY
    ws.cell(row=r, column=11, value=deliver).font = F_BODY
    ws.cell(row=r, column=12, value=(
        f'=IF(COUNTIF({DB},$A{r})=0,"未开始",'
        f'IF(COUNTIFS({DB},$A{r},{DH},"已完成")=COUNTIF({DB},$A{r}),"已完成",'
        f'IF(COUNTIFS({DB},$A{r},{DH},"未开始")=COUNTIF({DB},$A{r}),"未开始","进行中")))'
    )).font = F_BODY
    ws.cell(row=r, column=13,
            value=f'=REPT("█",MAX(1,ROUND($D{r}/MAX($D${M_FIRST}:$D${M_LAST})*18,0)))').font = F_BODY
    for col in range(1, 14):
        cell = ws.cell(row=r, column=col)
        cell.border = BORDER
        if col in (4, 5, 6, 7, 8, 9, 12, 13):
            cell.alignment = AL_C
        elif col in (3, 11):
            cell.alignment = AL_LW
        else:
            cell.alignment = AL_L
    ws.row_dimensions[r].height = 42

# 合计行
ws.cell(row=M_TOTAL, column=1, value="合计").font = F_BODY_W
ws.cell(row=M_TOTAL, column=3, value="5 个里程碑 / 45 项任务").font = F_BODY_W
ws.cell(row=M_TOTAL, column=4, value=f"=SUM(D{M_FIRST}:D{M_LAST})").number_format = FMT_DAY
ws.cell(row=M_TOTAL, column=5, value=f"=E{M_LAST}").number_format = FMT_DAY
ws.cell(row=M_TOTAL, column=6, value=f'=IF($E${M_TOTAL}=0,"",SUM(F{M_FIRST}:F{M_LAST}))').number_format = FMT_PCT
ws.cell(row=M_TOTAL, column=7, value=f"=G{M_LAST}").number_format = FMT_INT
ws.cell(row=M_TOTAL, column=9, value=f"=I{M_LAST}").number_format = FMT_DATE
for col in range(1, 14):
    cell = ws.cell(row=M_TOTAL, column=col)
    cell.fill = FILL_TOTAL
    if cell.font is None or cell.font.color is None or col == 1:
        cell.font = F_BODY_W
    cell.border = Border(left=thin, right=thin, top=Side(style="medium", color=XL_TOTAL_BG), bottom=thin)
    cell.alignment = AL_C if col != 3 else AL_L
ws.cell(row=M_TOTAL, column=1).font = F_BODY_W
ws.cell(row=M_TOTAL, column=3).font = F_BODY_W

# KPI 区（第 11~16 行，A/B 列）
K1 = 11
ws.cell(row=K1, column=1, value="总体进度（随「任务明细」状态自动计算）").font = F_TITLE
ws.merge_cells(start_row=K1, start_column=1, end_row=K1, end_column=3)
kpi = [
    ("总人日", f"=SUM({DE})", FMT_DAY),
    ("已完成人日", f'=SUMIF({DH},"已完成",{DE})', FMT_DAY),
    ("完成率", f'=IF($B${K1+1}=0,"",$B${K1+2}/$B${K1+1})', FMT_PCT),
    ("预计完成日（无缓冲）", f'={P_START}+ROUND($B${K1+1}*{P_RATIO},0)-1', FMT_DATE),
    ("预计完成日（含 20% 缓冲）", f'={P_START}+ROUND($B${K1+1}*{P_RATIO}*{P_BUFFER},0)-1', FMT_DATE),
]
for i, (label, formula, fmt) in enumerate(kpi):
    r = K1 + 1 + i
    lc = ws.cell(row=r, column=1, value=label)
    lc.font, lc.border, lc.alignment = F_BODY, BORDER, AL_L
    vc = ws.cell(row=r, column=2, value=formula)
    vc.font, vc.border, vc.alignment = F_BOLD, BORDER, AL_C
    vc.number_format = fmt
    vc.fill = FILL_CALC

SH_GANTT = ws
widths = {"A": 10, "B": 12, "C": 52, "D": 7, "E": 10, "F": 10, "G": 12,
          "H": 12, "I": 12, "J": 12, "K": 34, "L": 10, "M": 22}
for col, w in widths.items():
    ws.column_dimensions[col].width = w
ws.freeze_panes = "A4"


# ────────────────────────────────────────────────
# Sheet 2 · 任务明细（明细）
# ────────────────────────────────────────────────
ws2 = wb.create_sheet(SH_DETAIL)
ws2["A1"] = f"耄耋改名 · 实施任务明细（{len(TASKS)} 项任务）"
ws2.merge_cells(f"A1:K1")
ws2["A1"].font = F_TITLE
ws2["A1"].alignment = AL_L
ws2["A2"] = ("「状态」请下拉选择；「累计人日」「计划完成日」为公式列，不要手改。"
             "计划完成日 = 起始日期 + 累计人日 × 比率 − 1（参数见「假设与口径」）")
ws2.merge_cells("A2:K2")
ws2["A2"].font = F_NOTE
ws2["A2"].alignment = AL_L
ws2.row_dimensions[1].height = 26
ws2.row_dimensions[2].height = 18

d_head = ["任务编号", "里程碑", "任务名称", "所属模块", "人日", "依赖",
          "验收标志", "状态", "累计人日", "计划完成日", "备注"]
for i, name in enumerate(d_head, start=1):
    c = ws2.cell(row=D_HEAD, column=i, value=name)
    c.font, c.fill, c.alignment, c.border = F_HEAD, FILL_HEAD, AL_CW, BORDER
ws2.row_dimensions[D_HEAD].height = 30

for idx, (tid, ms, name, mod, pd, dep, accept, note) in enumerate(TASKS):
    r = D_FIRST + idx
    ws2.cell(row=r, column=1, value=tid).font = F_BOLD
    ws2.cell(row=r, column=2, value=ms).font = F_BODY
    ws2.cell(row=r, column=3, value=name).font = F_BODY
    ws2.cell(row=r, column=4, value=mod).font = F_BODY
    ws2.cell(row=r, column=5, value=pd).number_format = FMT_DAY
    ws2.cell(row=r, column=6, value=dep).font = F_BODY
    ws2.cell(row=r, column=7, value=accept).font = F_BODY
    st = ws2.cell(row=r, column=8, value="未开始")
    st.font, st.fill = F_BODY, FILL_INPUT
    ws2.cell(row=r, column=9, value=f"=SUM($E${D_FIRST}:E{r})").number_format = FMT_DAY
    ws2.cell(row=r, column=10, value=f"={P_START}+ROUND(I{r}*{P_RATIO},0)-1").number_format = FMT_DATE
    ws2.cell(row=r, column=11, value=note).font = F_BODY
    for col in range(1, 12):
        cell = ws2.cell(row=r, column=col)
        cell.border = BORDER
        if col in (1, 2, 4, 5, 6, 8, 9, 10):
            cell.alignment = AL_CW
        elif col in (3, 7, 11):
            cell.alignment = AL_LW
        else:
            cell.alignment = AL_L
    ws2.cell(row=r, column=9).fill = FILL_CALC
    ws2.cell(row=r, column=10).fill = FILL_CALC
    ws2.row_dimensions[r].height = 34

# 合计行
DT = D_LAST + 1
ws2.cell(row=DT, column=1, value="合计")
ws2.cell(row=DT, column=3, value=f"{len(TASKS)} 项任务")
ws2.cell(row=DT, column=5, value=f"=SUM(E{D_FIRST}:E{D_LAST})").number_format = FMT_DAY
ws2.cell(row=DT, column=9, value=f"=I{D_LAST}").number_format = FMT_DAY
ws2.cell(row=DT, column=10, value=f"=J{D_LAST}").number_format = FMT_DATE
for col in range(1, 12):
    cell = ws2.cell(row=DT, column=col)
    cell.fill = FILL_TOTAL
    cell.font = F_BODY_W
    cell.border = Border(left=thin, right=thin, top=Side(style="medium", color=XL_TOTAL_BG), bottom=thin)
    cell.alignment = AL_C if col != 3 else AL_L

# 状态下拉
dv = DataValidation(type="list", formula1='"未开始,进行中,已完成,阻塞"', allow_blank=False,
                    showDropDown=False)
dv.error = "请选择：未开始 / 进行中 / 已完成 / 阻塞"
dv.errorTitle = "状态取值无效"
ws2.add_data_validation(dv)
dv.add(f"H{D_FIRST}:H{D_LAST}")

for col, w in {"A": 10, "B": 9, "C": 50, "D": 15, "E": 7, "F": 15,
               "G": 34, "H": 10, "I": 10, "J": 12, "K": 32}.items():
    ws2.column_dimensions[col].width = w
ws2.freeze_panes = "C4"
ws2.auto_filter.ref = f"A{D_HEAD}:K{D_LAST}"

# 状态条件格式（明细）
rng_d = f"H{D_FIRST}:H{D_LAST}"
ws2.conditional_formatting.add(rng_d, CellIsRule(
    operator="equal", formula=['"已完成"'], fill=PatternFill("solid", fgColor=XL_OK_BG),
    font=Font(name=FONT, size=10, color=XL_OK_FG, bold=True)))
ws2.conditional_formatting.add(rng_d, CellIsRule(
    operator="equal", formula=['"进行中"'], fill=PatternFill("solid", fgColor=XL_WARN_BG),
    font=Font(name=FONT, size=10, color=XL_WARN_FG, bold=True)))
ws2.conditional_formatting.add(rng_d, CellIsRule(
    operator="equal", formula=['"阻塞"'], fill=PatternFill("solid", fgColor=XL_BAD_BG),
    font=Font(name=FONT, size=10, color=XL_BAD_FG, bold=True)))
# 计划完成日已过但未完成 → 红字
ws2.conditional_formatting.add(f"J{D_FIRST}:J{D_LAST}", FormulaRule(
    formula=[f'AND($J{D_FIRST}<>"",$J{D_FIRST}<TODAY(),$H{D_FIRST}<>"已完成")'],
    font=Font(name=FONT, size=10, color=XL_BAD_FG, bold=True)))


# ────────────────────────────────────────────────
# Sheet 3 · 验收用例对照
# ────────────────────────────────────────────────
ws3 = wb.create_sheet("验收用例对照")
ws3["A1"] = "验收用例 · 任务归属对照（PRD 第 10 章 TC-01 ~ TC-18）"
ws3.merge_cells("A1:G1")
ws3["A1"].font = F_TITLE
ws3["A1"].alignment = AL_L
ws3.row_dimensions[1].height = 26

t_head = ["用例编号", "用例名称", "对应功能", "主要相关任务", "可自动化", "状态", "验收要点"]
for i, name in enumerate(t_head, start=1):
    c = ws3.cell(row=T_HEAD, column=i, value=name)
    c.font, c.fill, c.alignment, c.border = F_HEAD, FILL_HEAD, AL_CW, BORDER
ws3.row_dimensions[T_HEAD].height = 30

for idx, (cid, cname, feat, tasks, auto, note) in enumerate(CASES):
    r = T_FIRST + idx
    ws3.cell(row=r, column=1, value=cid).font = F_BOLD
    ws3.cell(row=r, column=2, value=cname).font = F_BODY
    ws3.cell(row=r, column=3, value=feat).font = F_BODY
    ws3.cell(row=r, column=4, value=tasks).font = F_BODY
    ac = ws3.cell(row=r, column=5, value=auto)
    ac.font = F_BODY
    if auto == "是":
        ac.fill = PatternFill("solid", fgColor=XL_OK_BG)
        ac.font = Font(name=FONT, size=10, color=XL_OK_FG, bold=True)
    elif auto == "部分":
        ac.fill = PatternFill("solid", fgColor=XL_WARN_BG)
        ac.font = Font(name=FONT, size=10, color=XL_WARN_FG, bold=True)
    else:
        ac.fill = PatternFill("solid", fgColor=XL_BAD_BG)
        ac.font = Font(name=FONT, size=10, color=XL_BAD_FG, bold=True)
    st = ws3.cell(row=r, column=6, value="未通过")
    st.font, st.fill = F_BODY, FILL_INPUT
    ws3.cell(row=r, column=7, value=note).font = F_BODY
    for col in range(1, 8):
        cell = ws3.cell(row=r, column=col)
        cell.border = BORDER
        cell.alignment = AL_LW if col in (2, 4, 7) else AL_CW
    ws3.row_dimensions[r].height = 30

dv3 = DataValidation(type="list", formula1='"未通过,通过,阻塞,不适用"', allow_blank=False,
                     showDropDown=False)
dv3.error = "请选择：未通过 / 通过 / 阻塞 / 不适用"
dv3.errorTitle = "状态取值无效"
ws3.add_data_validation(dv3)
dv3.add(f"F{T_FIRST}:F{T_LAST}")

rng_t = f"F{T_FIRST}:F{T_LAST}"
ws3.conditional_formatting.add(rng_t, CellIsRule(
    operator="equal", formula=['"通过"'], fill=PatternFill("solid", fgColor=XL_OK_BG),
    font=Font(name=FONT, size=10, color=XL_OK_FG, bold=True)))
ws3.conditional_formatting.add(rng_t, CellIsRule(
    operator="equal", formula=['"未通过"'], fill=PatternFill("solid", fgColor=XL_WARN_BG),
    font=Font(name=FONT, size=10, color=XL_WARN_FG, bold=True)))
ws3.conditional_formatting.add(rng_t, CellIsRule(
    operator="equal", formula=['"阻塞"'], fill=PatternFill("solid", fgColor=XL_BAD_BG),
    font=Font(name=FONT, size=10, color=XL_BAD_FG, bold=True)))

for col, w in {"A": 10, "B": 32, "C": 16, "D": 18, "E": 10, "F": 10, "G": 46}.items():
    ws3.column_dimensions[col].width = w
ws3.freeze_panes = "A3"
ws3.auto_filter.ref = f"A{T_HEAD}:G{T_LAST}"


# ────────────────────────────────────────────────
# Sheet 4 · 假设与口径（配置/说明，放最后）
# ────────────────────────────────────────────────
ws4 = wb.create_sheet(SH_ASSUME)
ws4["A1"] = "排期口径与假设（本页是全部日期公式的参数来源，改动这里会联动全局）"
ws4.merge_cells("A1:C1")
ws4["A1"].font = F_TITLE
ws4["A1"].alignment = AL_L
ws4.row_dimensions[1].height = 26

for i, name in enumerate(["参数", "值", "说明"], start=1):
    c = ws4.cell(row=3, column=i, value=name)
    c.font, c.fill, c.alignment, c.border = F_HEAD, FILL_HEAD, AL_CW, BORDER

# 第4~8行：五项参数（B4 起始日 / B7 比率 / B8 缓冲系数 —— 公式依赖这三个锚点）
for idx, (label, value, kind, desc) in enumerate(ASSUMPTIONS):
    r = 4 + idx
    ws4.cell(row=r, column=1, value=label).font = F_BODY
    if kind == "calc":
        vc = ws4.cell(row=r, column=2, value="=B6/B5")
        vc.number_format = "0.00"
        vc.fill = FILL_CALC
    else:
        vc = ws4.cell(row=r, column=2, value=value)
        vc.fill = FILL_INPUT
        vc.number_format = FMT_DATE if kind == "date" else "0.0"
    vc.font, vc.alignment = F_BOLD, AL_C
    ws4.cell(row=r, column=3, value=desc).font = F_BODY
    for col in range(1, 4):
        cell = ws4.cell(row=r, column=col)
        cell.border = BORDER
        if col == 3:
            cell.alignment = AL_LW
        elif col == 1:
            cell.alignment = AL_L
    ws4.row_dimensions[r].height = 30

# 第10~12行：汇总
summary = [
    ("总人日", f"=SUM({DE})", FMT_DAY),
    ("折算总日历天（无缓冲）", "=ROUND(B10*B7,0)", FMT_INT),
    ("预计完成日（无缓冲）", "=B4+B11-1", FMT_DATE),
    ("预计完成日（含 20% 缓冲）", "=B4+ROUND(B10*B7*B8,0)-1", FMT_DATE),
]
for idx, (label, formula, fmt) in enumerate(summary):
    r = 10 + idx
    lc = ws4.cell(row=r, column=1, value=label)
    lc.font, lc.border, lc.alignment = F_BODY, BORDER, AL_L
    vc = ws4.cell(row=r, column=2, value=formula)
    vc.font, vc.border, vc.alignment, vc.fill = F_BOLD, BORDER, AL_C, FILL_CALC
    vc.number_format = fmt
    ws4.cell(row=r, column=3).border = BORDER

# 说明块
notes = [
    ("", ""),
    ("口径说明", ""),
    ("· 人日定义", "1 人日 = 3 小时有效投入，已按 AI 辅助开发（AI 写码、人做决策与验证）的速度折算。"),
    ("· 日历天折算", "日历天 = 人日 × (3 小时 ÷ 每天有效投入)。按每天 2.5 小时计，1 人日 ≈ 1.2 个日历天。"),
    ("· 里程碑衔接", "里程碑顺序执行。MS-3 与 MS-4 都只依赖 MS-2，理论上可并行；但由同一人推进，故按串行排。"),
    ("· 未含缓冲的完成日", "所有里程碑日期为「无缓冲」推演值；含 20% 缓冲的完成日见上方汇总最后一行。"),
    ("", ""),
    ("按当前参数推演的关键日期", ""),
    ("· MS-1 引擎先行", "无依赖，最先开始。完成后即可用命令行验证改名引擎（PRD 的 MS-1 交付物）。"),
    ("· MS-2 界面成型", "依赖 MS-1。界面上线后可完成第一次完整改名。"),
    ("· MS-3 注入灵魂", "依赖 MS-2。含全项目工作量最大的单项（T-3.4 咬名字动画，3 人日）。"),
    ("· MS-4 安全闭环", "依赖 MS-2。安全底线（冲突不覆盖 / 撤销）到此可端到端验证。"),
    ("· MS-5 打包发布", "依赖 MS-3 与 MS-4。体积实测若超 100MB，需回头评审 PRD 的这一指标。"),
    ("", ""),
    ("本排期表不含的内容", ""),
    ("· P1 功能", "正则规则（F-10）、多规则链、大小写转换（F-11）均不在 MVP 排期内。"),
    ("· P2 功能", "模板库（F-12）、完整历史（F-13）、深色模式（F-14）、命令行模式（F-15）不在排期内。"),
    ("· 美术终稿", "猫咪形象为可替换占位，版权为 Accepted Risk；最终美术稿的产出时间不在本表内。"),
]
r = 16
for label, desc in notes:
    if label and not desc:
        c = ws4.cell(row=r, column=1, value=label)
        c.font = Font(name=FONT, size=11, bold=True, color=XL_TITLE_FG)
        ws4.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    elif label:
        c1 = ws4.cell(row=r, column=1, value=label)
        c1.font = F_BODY
        c1.alignment = AL_L
        c2 = ws4.cell(row=r, column=2, value=desc)
        ws4.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
        c2.font = F_BODY
        c2.alignment = AL_LW
        ws4.row_dimensions[r].height = 28
    r += 1

for col, w in {"A": 30, "B": 18, "C": 62}.items():
    ws4.column_dimensions[col].width = w

wb.properties.title = "耄耋改名 · 技术方案实施排期表"
OUT = r"D:\工作环境\批量文件改名\01-立项与规范\耄耋改名_技术方案排期表.xlsx"
wb.save(OUT)
print("SAVED", OUT)
print("sheets:", wb.sheetnames)
print("tasks:", len(TASKS), "cases:", len(CASES))
