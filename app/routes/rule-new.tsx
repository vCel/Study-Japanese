import type { Route } from "./+types/rule-new";
import { guardAdminAction, readFormToken } from "~/lib/auth.server";
import { createRule, listRuleOptions } from "~/lib/db.server";
import { draftToRulePayload, readRuleDrafts } from "~/lib/rule-draft";
import { RulesCreateForm, type RuleFormActionData } from "~/components/rule-form";
import { PageHeader } from "~/components/page-header";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Add rules · 日本語Vocab" }];
}

/** The existing rules, so the form can offer them as "related rules". */
export async function loader() {
  return { ruleOptions: await listRuleOptions() };
}

/**
 * Creates every rule the form holds — the create page keeps one rule per
 * accordion panel, so a single submission can add several. The JSON importer
 * fills those panels client-side; whatever ends up in `rulesJson` is what gets
 * validated and written here.
 */
export async function action({ request }: Route.ActionArgs): Promise<RuleFormActionData> {
  const form = await request.formData();

  const guard = await guardAdminAction(request, readFormToken(form));
  if (!guard.ok) {
    return { ok: false, error: guard.message };
  }

  const raw = typeof form.get("rulesJson") === "string" ? (form.get("rulesJson") as string) : "";
  const parsed = readRuleDrafts(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  let created = 0;
  const problems: string[] = [];

  for (const [index, draft] of parsed.drafts.entries()) {
    const payload = draftToRulePayload(draft);
    if (!payload.ok) {
      problems.push(`Rule ${index + 1}: ${payload.error}`);
      continue;
    }
    try {
      await createRule(payload.payload, guard.user.id);
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown database error";
      problems.push(`Rule ${index + 1} could not be saved (${message}).`);
    }
  }

  if (created === 0) {
    return { ok: false, error: problems[0] ?? "No rules could be created." };
  }
  if (problems.length > 0) {
    return {
      ok: false,
      created,
      error: `${created} created, but ${problems[0]}`,
    };
  }
  return { ok: true, created };
}

export default function RuleNew({ loaderData }: Route.ComponentProps) {
  return (
    <div className="w-full">
      <PageHeader
        title="Add rule"
        breadcrumbs={[{ label: "Rules & forms", to: "/rules" }]}
        description="Build one rule, add more with the Add rule button, or paste JSON to fill the form in."
      />
      <RulesCreateForm ruleOptions={loaderData.ruleOptions} />
    </div>
  );
}
