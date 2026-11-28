# RecallRelay · Frozen Study Results (`Track 1: Test Something Real`)

- **Frozen At:** `2026-11-28` (`v1.0.0` release freeze)
- **Flagsmith Environment & Experiment:** `Study` · Feature `recall_response_flow` · Experiment `#718` · Primary Metric `recall_drill_success` (`Occurrence`, Higher is better)
- **Authoritative Raw Exports:**
  - Deidentified session CSV: [`reports/recallrelay_experiment_results.csv`](recallrelay_experiment_results.csv)
  - Verified summary JSON: [`reports/recallrelay_experiment_summary.json`](recallrelay_experiment_summary.json)
- **Practice Run Isolation:** Strictly excluded (`include_practice: false`). Every row in the export is an unauthenticated remote human participant session on `/join`.

---

## 1. Primary & Secondary Outcome Summary (`n = 27` Valid Exposed)

| Variant | Valid Exposed (`n`) | Qualified Success (`<= 300s`) | Conversion Rate | Median Completion Time | Incorrect Attempts | Timeouts | Abandoned / Incomplete |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Control · `standard`** (Single-Page) | **18** | **14** | **77.78%** (`14 / 18`) | **`9.00s`** | `8` | `0` | `4` |
| **Treatment · `guided`** (3-Step) | **9** | **8** | **88.89%** (`8 / 9`) | **`13.79s`** | `6` | `0` | `1` |
| **Observed Difference (`guided - standard`)** | `27` total | `22` total | **`+11.11 pp`** | `+4.79s` | — | `0` | — |

### Exclusions & Outbox Reconciliation
- **Total Study Rows Recorded:** `28`
- **Valid Exposed Denominator:** `27`
- **Excluded Sessions:** `1` (`exclusions_by_reason: {"pending": 1}` — session created prior to clicking Start; excluded from denominator by protocol).
- **Flagsmith Event Outbox:** **`107` dispatched · `0` pending · `0` failed** (`100%` delivery parity).
- **CSV Reproducibility Check:** `python scripts/export_results.py --out-dir ./reports` re-read `recallrelay_experiment_results.csv` and verified exact numerator/denominator parity against `recallrelay_experiment_summary.json`.

---

## 2. Interpretation & Honest Uncertainty
1. **Directional Accuracy vs. Speed Trade-Off:**
   - Participants assigned to **`guided`** (3-step `Count → Reconcile → Confirm`) achieved a higher first-verified completion rate (**`88.89%`**, `8 / 9`) and lower abandonment (`1 / 9`) than **`standard`** (**`77.78%`**, `14 / 18`, `4 / 18` abandoned).
   - Among successful completions, **`standard`** was faster (`9.00s` median vs. `13.79s` median in `guided`), reflecting the extra confirmation step in the 3-step workflow.
2. **Statistical Uncertainty (Small Sample Size):**
   - At `n = 27` valid exposed participants (`18` standard, `9` guided), the observed `+11.11 percentage point` lift is **directionally encouraging but not statistically significant** (`p > 0.05` on a two-sided Fisher's exact test; wide 95% confidence interval). We intentionally do **not** claim statistical significance or generalize to real-world regulatory recalls from a 4-day hackathon cohort.
3. **Observed Sample-Ratio Split (`18` vs. `9`):**
   - Flagsmith Cloud `Study` was configured at a `50% / 50%` split with deterministic identity hashing. At small `n = 27`, random binomial fluctuation (`P(|X - 13.5| >= 4.5) ≈ 0.12`) naturally produces uneven group sizes; no assignment code or flag weights were altered mid-study.
4. **Actionable UX Finding From Real Human Errors:**
   - Across both variants, participants logged `14` total incorrect validation attempts (`8` in `standard`, `6` in `guided`), including mathematically balanced splits that did not match the ground-truth shop notice (`5 sold / 10 remaining`). Keeping the ground-truth grading rule frozen revealed that dense notice text drives real misreads under time pressure — pointing to structured quantity callouts as the highest-leverage next iteration.
