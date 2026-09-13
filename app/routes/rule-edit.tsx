import { Link, useActionData, useLoaderData } from "react-router";

import type { Route } from "./+types/rule-edit";
import { deleteRule, getRule, listRuleOptions, updateRule } from "~/lib/db.server";
import { draftToRulePayload, readRuleDrafts } from "~/lib/rule-draft";
import { ownerContext } from "~/lib/owner.server";
import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";
import { DeleteButton } from "~/components/delete-button";
import { PageHeader } from "~/components/page-header";
import { RuleForm, RULE_FORM_ID, type RuleFormActionData } from "~/components/rule-form";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit rule · 日本語Vocab" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid rule id", { status: 400 });
  }
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  const rule = await getRule(ownerId, id);
  if (!rule) {
    throw new Response("Rule not found", { status: 404 });
  }
  // Every rule of this owner, so "related rules" can be picked by hand here too.
  return { rule, ruleOptions: await listRuleOptions(ownerId) };
}

export interface RuleEditActionData {
  ok: boolean;
  error?: string;
  deleted?: boolean;
}

export async function action({ request, params, context }: Route.ActionArgs): Promise<RuleEditActionData> {
  const ruleId = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(ruleId)) {
    return { ok: false, error: "Invalid rule id." };
  }

  const limit = await enforceRateLimit("UPLOAD_LIMITER", getClientIp(request), "upload");
  if (!limit.allowed) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }

  const owner = context.get(ownerContext);
  if (!owner) {
    return { ok: false, error: "Could not identify your library." };
  }

  const form = await request.formData();

  if (form.get("action") === "delete") {
    const removed = await deleteRule(owner.ownerId, ruleId);
    if (!removed) {
      return { ok: false, error: "Rule not found." };
    }
    return { ok: true, deleted: true };
  }

  // The edit form posts one rule draft, in the same shape the create page uses.
  const raw = typeof form.get("ruleJson") === "string" ? (form.get("ruleJson") as string) : "";
  const parsed = readRuleDrafts(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const payload = draftToRulePayload(parsed.drafts[0]!);
  if (!payload.ok) {
    return { ok: false, error: `Rule ${payload.error}` };
  }

  const updated = await updateRule(owner.ownerId, ruleId, payload.payload);
  if (!updated) {
    return { ok: false, error: "Rule not found." };
  }
  return { ok: true };
}

export default function RuleEdit() {
  const { rule, ruleOptions } = useLoaderData<typeof loader>();
  const actionData = useActionData() as RuleEditActionData | undefined;

  return (
    <div className="w-full">
      <PageHeader
        title="Edit rule"
        breadcrumbs={[
          { label: "Rules & forms", to: "/rules" },
          { label: rule.title, to: `/rules/${rule.id}` },
        ]}
        description="Rules are private to you — edit this rule, including its points and examples."
      />
      <RuleForm
        rule={rule}
        ruleOptions={ruleOptions}
        deleteSlot={
          <DeleteButton
            formId={RULE_FORM_ID}
            label="rule"
            redirectTo="/rules"
            deleted={actionData?.deleted}
            description="Its examples and tags are removed too."
            size="lg"
          />
        }
      />
      {actionData?.ok && !actionData.deleted && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Saved. View it{" "}
          <Link to={`/rules/${rule.id}`} className="text-primarylw hover:underline">
            here
          </Link>
          .
        </p>
      )}
    </div>
  );
}