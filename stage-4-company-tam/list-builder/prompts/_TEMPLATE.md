# Judge prompt template (assemble with make-judge.ts — do NOT hand-copy)
#
# Every lane judge MUST contain the four MANDATORY blocks below verbatim.
# Omitting them caused real production false negatives (2026-07-03: funds
# rejected for unstated AUM, agencies rejected for sparse splash pages).
# Lane-specific content goes in the {{...}} slots.

ICP: {{ICP_ONE_LINER}}

QUALIFIES ({{LEAN_DIRECTION}}):
{{QUALIFIES_BULLETS}}

DOES NOT QUALIFY:
{{DISQUALIFIES_BULLETS}}

## MANDATORY BLOCK 1 — size evidence
Absence of AUM / revenue / size information is NOT a reason to reject — most private
companies do not publish it. Only disqualify on size when evidence CLEARLY shows a
mega-firm far outside the stated range.

## MANDATORY BLOCK 2 — screening separation
Geography and employee-headcount screening are handled separately by database filters.
Do NOT reject for unstated location or unstated size; only reject when evidence clearly
shows the company is based outside the United States.

## MANDATORY BLOCK 3 — sparse websites
Minimal/splash-page websites are common for private firms. A sparse site is NOT
disqualifying when the name/branding/evidence is consistent with the ICP — reject only
on positive evidence of a DIFFERENT business.

## MANDATORY BLOCK 4 — identity language
Qualify on how the company DESCRIBES ITSELF (its identity language), not on whether it
proves operational details. When evidence is thin but the identity language fits, lean
{{THIN_EVIDENCE_LEAN}} with lower confidence rather than rejecting outright.
