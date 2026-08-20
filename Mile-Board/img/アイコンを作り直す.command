#!/bin/zsh
# ============================================================
#  アイコンを作り直す
#
#  app-icon.svg を直したあと、このファイルをダブルクリックしてください。
#  ホーム画面とタブに出るPNG（180・192・512）を作り直します。
#
#  ★ 作り直しただけでは、ホーム画面のアイコンは変わりません。
#    ホーム画面からいったん消して、追加し直してください。
#    iPhoneは一度覚えたアイコンを、しつこく使い続けます。
# ============================================================

cd "$(dirname "$0")" || exit 1

echo "アイコンを作り直します"
echo "  もと： $(pwd)/app-icon.svg"
echo

if [ ! -f app-icon.svg ]; then
  echo "app-icon.svg が見つかりません。"
  echo "このファイルは img フォルダの中に置いてください。"
  echo
  read "?閉じるには Enter を押してください"
  exit 1
fi

for s in 512 192 180; do
  rm -f app-icon.svg.png
  if qlmanage -t -s $s -o . app-icon.svg >/dev/null 2>&1 && [ -f app-icon.svg.png ]; then
    mv app-icon.svg.png "app-icon-$s.png"
    echo "  ○ app-icon-$s.png"
  else
    echo "  × app-icon-$s.png を作れませんでした"
  fi
done

echo
echo "できました。中身はこうなっています。"
ls -lh app-icon-*.png | awk '{print "  " $9 "  " $5}'
echo
echo "----------------------------------------"
echo "このあと、画面に出す版番号も上げてください。"
echo "  index.html の ?v=20260821d の数字を1つ上げる"
echo "上げないと、直したはずの画面が変わりません。"
echo "----------------------------------------"
echo

read "?閉じるには Enter を押してください"
