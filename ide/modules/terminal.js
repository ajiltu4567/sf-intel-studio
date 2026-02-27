/**
 * SF-Intel Studio - Terminal & Problems Module
 */

const Terminal = {
    _scrollDebounce: null,
    _userIsScrollingUp: false,

    init() {
        const out = document.getElementById('terminal-output');
        if (out) {
            out.addEventListener('scroll', () => {
                const atBottom = out.scrollHeight - out.scrollTop <= out.clientHeight + 60;
                this._userIsScrollingUp = !atBottom;
            });
        }
    },

    log(msg, type = 'info') {
        const out = document.getElementById('terminal-output');
        const container = document.getElementById('terminal-log-container');
        if (!out || !container) return;

        const line = document.createElement('div');
        line.className = `term-line ${type}`;

        const ts = new Date().toLocaleTimeString();
        line.innerHTML = `<span class="timestamp">[${ts}]</span> ${msg}`;

        container.appendChild(line);
        this.scheduleScroll();
    },

    scheduleScroll() {
        if (this._userIsScrollingUp) return;

        if (this._scrollDebounce) cancelAnimationFrame(this._scrollDebounce);
        this._scrollDebounce = requestAnimationFrame(() => {
            const sentinel = document.getElementById('terminal-sentinel');
            if (sentinel) {
                sentinel.scrollIntoView({ behavior: 'auto', block: 'end' });
                // Small redundant layout safety
                setTimeout(() => { sentinel.scrollIntoView({ behavior: 'auto', block: 'end' }); }, 16);
                setTimeout(() => { sentinel.scrollIntoView({ behavior: 'auto', block: 'end' }); }, 64);
            }
            this._scrollDebounce = null;
        });
    },

    success(msg) { this.log(msg, 'success'); },
    error(msg) { this.log(msg, 'error'); },
    warn(msg) { this.log(msg, 'warning'); },

    clear() {
        const container = document.getElementById('terminal-log-container');
        if (container) container.innerHTML = '';
        this.scheduleScroll();
    },

    toggle() {
        const panel = document.getElementById('bottom-panel');
        if (panel) {
            panel.classList.toggle('collapsed');
            if (!panel.classList.contains('collapsed')) {
                this._userIsScrollingUp = false; // Reset on open
                this.scheduleScroll();
            }
        }
    },

    open() {
        const panel = document.getElementById('bottom-panel');
        if (panel) {
            panel.classList.remove('collapsed');
            this._userIsScrollingUp = false; // Reset on open
            this.scheduleScroll();
        }
    }
};

const Problems = {
    diagnostics: [],
    update(newDiagnostics) {
        this.diagnostics = newDiagnostics;
        this.render();

        const count = newDiagnostics.length;
        const badge = document.getElementById('problem-count');
        if (count > 0) {
            if (badge) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            }
            this.open();
            if (typeof window.switchBottomTab === 'function') {
                window.switchBottomTab('problems');
            }
        } else {
            if (badge) badge.style.display = 'none';
        }
    },
    render() {
        const list = document.getElementById('problems-list');
        if (!list) return;

        if (this.diagnostics.length === 0) {
            list.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #666;">No problems found</td></tr>';
            return;
        }

        // Sort by severity (errors first) then line number
        const sorted = [...this.diagnostics].sort((a, b) => {
            if (b.severity !== a.severity) return b.severity - a.severity;
            return a.line - b.line;
        });

        list.innerHTML = sorted.map(p => {
            const severityClass = p.severity === 8 ? 'problem-error' : (p.severity === 4 ? 'problem-warning' : 'problem-info');
            const icon = p.severity === 8 ? '❌' : (p.severity === 4 ? '⚠️' : 'ℹ️');

            return `
                <tr class="${severityClass}" data-file-id="${p.fileId}" data-line="${p.line || ''}">
                    <td class="problem-err-icon">${icon}</td>
                    <td class="problem-file">${p.file}</td>
                    <td class="problem-line">${p.line || '-'}</td>
                    <td class="problem-msg" title="${p.message}">${p.message}</td>
                </tr>
            `;
        }).join('');

        // Event Delegation for Navigation (CSP Compliant)
        if (!list.hasListener) {
            list.addEventListener('click', (e) => {
                const tr = e.target.closest('tr');
                if (tr) {
                    const fileId = tr.getAttribute('data-file-id');
                    const line = parseInt(tr.getAttribute('data-line'), 10);
                    if (fileId && window.navigateToProblem) {
                        window.navigateToProblem(fileId, line || 1);
                    }
                }
            });
            list.hasListener = true;
        }
    },
    clear() { this.update([]); },
    open() {
        const panel = document.getElementById('bottom-panel');
        if (panel) panel.classList.remove('collapsed');
    }
};

// Export to window for global access across scripts
window.Terminal = Terminal;
window.Problems = Problems;

// Initialize terminal listeners
setTimeout(() => Terminal.init(), 100);
