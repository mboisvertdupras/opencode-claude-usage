import { Rpc } from "@opencode/plugin/rpc"
import { Schema } from "effect"
import { Snapshot } from "./usage"

const snapshot = Schema.toStandardSchemaV1(Snapshot)

export const ClaudeUsage = Rpc.define({
  id: "claude-usage",
  methods: {
    get: { input: Schema.toStandardSchemaV1(Schema.Undefined), output: snapshot },
    refresh: { input: Schema.toStandardSchemaV1(Schema.Undefined), output: snapshot },
  },
  events: {
    updated: { schema: snapshot },
  },
})
