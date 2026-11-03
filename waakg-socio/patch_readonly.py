#!/usr/bin/env python3
"""Pin Socio gateway behavior: a read-only history collector, no native bot.
Refuse to build when the verified upstream source changes anchors.
"""
from pathlib import Path
p=Path("/app/src/modules/whatsapp/manager.ts")
s=p.read_text()
old='                        enabled: true,'
assert s.count(old)==1, "WA-AKG bot default changed"
p.write_text(s.replace(old,'                        enabled: false,'))
p=Path("/app/src/modules/whatsapp/instance.ts")
s=p.read_text()
old='                bindAutoReply(this.socket as WASocket, this.sessionId);'
assert s.count(old)==1, "WA-AKG auto-reply hook changed"
s=s.replace(old,'''                // Sócio never permits gateway-native automatic replies.
                if (process.env.SOCIO_GATEWAY_READ_ONLY !== "true") {
                    bindAutoReply(this.socket as WASocket, this.sessionId);
                }''')
old='        // Apply Anti-Spam & Interactive Message Wrapper to sendMessage'
assert s.count(old)==1, "WA-AKG message wrapper changed"
s=s.replace(old,'''        // Disable all gateway message sends in read-only mode, including
        // background scheduled messages, command handlers, and API sends.
        if (process.env.SOCIO_GATEWAY_READ_ONLY === "true") {
            this.socket.sendMessage = async () => {
                throw new Error("SOCIO_GATEWAY_READ_ONLY: outbound messaging disabled");
            };
        }
'''+old)
# Guard the existing wrapper so it cannot replace the read-only override.
old='        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {'
assert s.count(old)==1, "WA-AKG send wrapper changed"
s=s.replace(old,'''        if (process.env.SOCIO_GATEWAY_READ_ONLY !== "true") {
        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {''')
old='        } as any;\n\n        // Bind Store'
assert s.count(old)==1, "WA-AKG wrapper closure changed"
s=s.replace(old,'        } as any;\n        }\n\n        // Bind Store')
p.write_text(s)
# Gateway POST /bot-config does not update enabled on existing sessions;
# force the configured false value and preserve disabled on every bootstrap.
p=Path("/app/src/app/api/sessions/[sessionId]/bot-config/route.ts")
s=p.read_text()
old='            update: {\n                botMode: body.botMode,'
assert s.count(old)==1, "WA-AKG config update anchor changed"
s=s.replace(old,'            update: {\n                enabled: false,\n                botMode: body.botMode,')
old='                enabled: body.enabled ?? true,'
assert s.count(old)==1
s=s.replace(old,'                enabled: false,')
p.write_text(s)
print("Sócio gateway: native bot disabled, outbound disabled, disabled by default")
