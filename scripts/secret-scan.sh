#!/usr/bin/env bash
# 推送前脱敏扫描：内网地址、公司域名 / 产品名、真实 openId / token。
#   bash scripts/secret-scan.sh --staged   只扫暂存区新增的行（git diff --cached）
#   bash scripts/secret-scan.sh --all      扫全部已跟踪文件（git ls-files，含工作区改动）
# 命中即打印「文件:行号:内容」并 exit 1；无命中 exit 0。
# 仓库级追加规则：根目录 .secret-scan-extra（每行一个 ERE，# 开头为注释），该文件与本脚本不参与扫描。
# 正则字面量拆成片段拼接，避免本脚本被自己扫中。
set -euo pipefail

mode="${1:---all}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

# ---- 规则（大小写敏感）----
p_ip="192\\.168""\\."
p_ip10="\\b10\\.[0-9]{1,3}\\.[0-9]{1,3}""\\.[0-9]{1,3}\\b"
p_gfw="gfw\\.""com"
p_gitlab="git""lab\\.[A-Za-z0-9-]+\\.[A-Za-z]"      # gitlab.<host>.<tld>；事件名 gitlab.mr 之类不算
p_mail="@ma""il\\."
p_openid="D""[0-9A-Za-z]{25,}"
p_sftok="sf_""token=[0-9a-f]{16,}"
p_tok="tok""en: [0-9a-f]{32,}"
p_dm="dm"":D[0-9A-Za-z]{6,}"
CS="${p_ip}|${p_ip10}|${p_gfw}|${p_gitlab}|${p_mail}|${p_openid}|${p_sftok}|${p_tok}|${p_dm}"
# ---- 规则（忽略大小写）：公司 / 产品名 ----
n1="love""nse"; n2="hyt""to"; n3="vibe""mate"; n4="surf""ease"
CI="${n1}|${n2}|${n3}|${n4}"
# ---- 仓库级追加规则（大小写敏感）----
if [[ -f .secret-scan-extra ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    CS="${CS}|${line}"
  done < .secret-scan-extra
fi

EXCLUDES=(':!package-lock.json' ':!Cargo.lock' ':!scripts/secret-scan.sh' ':!.secret-scan-extra')

case "$mode" in
  --all)
    hits="$( { git grep -nIE "$CS" -- . "${EXCLUDES[@]}" || true; git grep -nIiE "$CI" -- . "${EXCLUDES[@]}" || true; } | sort -u )"
    ;;
  --staged)
    # 只看新增行；输出「文件:新行号:内容」
    diff="$(git diff --cached -U0 --no-color --no-ext-diff -- . "${EXCLUDES[@]}")"
    lines="$(printf '%s\n' "$diff" | awk '
      /^\+\+\+ / { f = substr($0, 7); next }
      /^@@ / { split($3, a, ","); n = substr(a[1], 2) + 0; next }
      /^\+/ { print f ":" n ":" substr($0, 2); n++; next }
    ')"
    hits="$( { printf '%s\n' "$lines" | grep -E "$CS" || true; printf '%s\n' "$lines" | grep -iE "$CI" || true; } | sort -u )"
    ;;
  *)
    echo "用法：$0 --staged | --all" >&2; exit 2 ;;
esac

if [[ -n "$hits" ]]; then
  echo "secret-scan：发现疑似敏感内容（请替换为占位后再提交 / 推送）：" >&2
  printf '%s\n' "$hits"
  exit 1
fi
echo "secret-scan：$mode 无命中"
