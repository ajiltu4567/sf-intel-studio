/**
 * org-environment.js
 * Canonical org environment classification engine.
 * Exposes window.OrgEnvironment — loaded before ide.js.
 */
window.OrgEnvironment = (() => {

    // ── Canonical enum ────────────────────────────────────────────────────
    const ENV = {
        PRODUCTION: { riskLevel: 'CRITICAL', label: 'PRODUCTION' },
        UAT:        { riskLevel: 'MEDIUM',   label: 'UAT'        },
        SIT:        { riskLevel: 'LOW',      label: 'SIT'        },
        QA:         { riskLevel: 'LOW',      label: 'QA'         },
        STAGE:      { riskLevel: 'MEDIUM',   label: 'STAGE'      },
        PERF:       { riskLevel: 'LOW',      label: 'PERF'       },
        TEST:       { riskLevel: 'LOW',      label: 'TEST'       },
        DEV:        { riskLevel: 'LOW',      label: 'DEV'        },
        FULL:       { riskLevel: 'LOW',      label: 'FULL'       },
        PARTIAL:    { riskLevel: 'LOW',      label: 'PARTIAL'    },
        SANDBOX:    { riskLevel: 'LOW',      label: 'SANDBOX'    },
        UNKNOWN:    { riskLevel: 'LOW',      label: 'UNKNOWN'    },
    };

    // ── Token → environment table (first-match-wins) ──────────────────────
    const TOKEN_MAP = [
        { tokens: ['uat'],                       env: 'UAT'     },
        { tokens: ['sit'],                       env: 'SIT'     },
        { tokens: ['qa'],                        env: 'QA'      },
        { tokens: ['stage', 'stg'],              env: 'STAGE'   },
        { tokens: ['perf', 'performance'],       env: 'PERF'    },
        { tokens: ['test'],                      env: 'TEST'    },
        { tokens: ['dev', 'deved', 'developer'], env: 'DEV'     },
        { tokens: ['full', 'fullcopy'],          env: 'FULL'    },
        { tokens: ['partial', 'partialcopy'],    env: 'PARTIAL' },
    ];

    /**
     * Normalize an identifier into a clean token array.
     * Handles: lowercase, _ and - → space, split, trim, dedupe empties.
     */
    function tokenize(str) {
        if (!str) return [];
        return str
            .toLowerCase()
            .replace(/[_\-]/g, ' ')
            .split(/[\s.]+/)
            .map(t => t.replace(/[^a-z0-9]/g, '').trim())
            .filter(Boolean);
    }

    /**
     * Build the token set from all available org signals:
     *   - Sandbox name extracted from URL (company--sandboxname.sandbox.my.salesforce.com)
     *   - Org Name field from Organization SOQL
     */
    function buildTokens(instanceUrl, org) {
        const sources = [];
        // Extract --sandboxname from URL
        const m = (instanceUrl || '').match(/--([^.]+)\./);
        if (m) sources.push(m[1]);
        // Org name as secondary signal
        if (org?.Name) sources.push(org.Name);
        return [...new Set(sources.flatMap(s => tokenize(s)))];
    }

    /**
     * classify(org, instanceUrl) → { environment, riskLevel, label }
     * Never throws. Defaults to UNKNOWN on any error.
     */
    // OrganizationType values that are non-sandbox but also non-production
    const NON_PROD_ORG_TYPES = new Set([
        'Developer Edition',
        'Trial',
    ]);

    function classify(org, instanceUrl) {
        try {
            // Step 1 — Production (authoritative, but exclude known safe org types)
            // Developer Edition and Trial are IsSandbox=false but are NOT live production
            if (org && org.IsSandbox === false) {
                if (org.OrganizationType && NON_PROD_ORG_TYPES.has(org.OrganizationType)) {
                    return { environment: 'DEV', ...ENV.DEV };
                }
                return { environment: 'PRODUCTION', ...ENV.PRODUCTION };
            }

            // Step 3–4 — Tokenized pattern matching
            const tokens = buildTokens(instanceUrl, org);
            for (const rule of TOKEN_MAP) {
                if (tokens.some(t => rule.tokens.includes(t))) {
                    return { environment: rule.env, ...ENV[rule.env] };
                }
            }

            // Step 5 — Generic sandbox fallback
            if (org?.IsSandbox === true) {
                return { environment: 'SANDBOX', ...ENV.SANDBOX };
            }

            // Step 6 — Unknown safety net
            return { environment: 'UNKNOWN', ...ENV.UNKNOWN };
        } catch (_) {
            return { environment: 'UNKNOWN', ...ENV.UNKNOWN };
        }
    }

    /**
     * renderBadge(result) — writes the org badge into the header.
     * Cached in window._orgEnvironmentResult — safe to call multiple times.
     */
    function renderBadge(result) {
        if (!result) return;
        window._orgEnvironmentResult = result;

        const badge = document.getElementById('org-type-badge');
        if (!badge) return;

        const riskClass = {
            CRITICAL: 'org-type-badge--critical',
            MEDIUM:   'org-type-badge--medium',
            LOW:      'org-type-badge--low',
        }[result.riskLevel] || 'org-type-badge--low';

        badge.textContent = result.riskLevel === 'CRITICAL' ? `⚠ ${result.label}` : result.label;
        badge.className = `org-type-badge ${riskClass}`;
        badge.style.display = '';

        // Tint the URL badge only for production
        const urlBadge = document.getElementById('instance-url');
        if (urlBadge) {
            urlBadge.classList.toggle('badge--production', result.riskLevel === 'CRITICAL');
        }
    }

    return { classify, renderBadge, ENV };
})();
