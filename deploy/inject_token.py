import sys

PATH = "/home/ubuntu/ai-stack/docker-compose.yml"
TOKEN_PATH = "/home/ubuntu/Screener/.snapshot-token"

with open(PATH) as handle:
    text = handle.read()

if "RANKING_SNAPSHOT_TOKEN" in text:
    print("token already present; nothing changed")
    sys.exit(0)

with open(TOKEN_PATH) as handle:
    token = handle.read().strip()

anchor = '      SCREENER_MIN_SCORE: "4"\n'
if anchor not in text:
    print("ANCHOR NOT FOUND", file=sys.stderr)
    sys.exit(1)

addition = (
    anchor
    + '      SCREENER_FEE_PCT: "0.1"\n'
    + '      RANKING_SNAPSHOT_TOKEN: "' + token + '"\n'
)
text = text.replace(anchor, addition, 1)

with open(PATH, "w") as handle:
    handle.write(text)
print("token injected")
