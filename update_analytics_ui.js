const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public/index.html');
let html = fs.readFileSync(filePath, 'utf8');

// Add Date Filter
html = html.replace(
    /<select id="analyticsStoreFilter"/,
    `<select id="analyticsDateFilter" class="form-select border shadow-sm" style="width: auto; min-width: 150px;" onchange="loadAnalytics()">
                            <option value="">⏳ Semua Waktu</option>
                            <option value="today">📅 Hari Ini</option>
                            <option value="yesterday">📆 Kemarin</option>
                            <option value="7days">🗓️ 7 Hari Terakhir</option>
                        </select>
                    <select id="analyticsStoreFilter"`
);

// Add Modal for Leads
const modalHtml = `
    <!-- Analytics Leads Modal -->
    <div class="modal fade" id="analyticsLeadsModal" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content border-0 shadow-lg" style="border-radius:15px; overflow:hidden;">
                <div class="modal-header bg-light border-0 py-3">
                    <h5 class="modal-title fw-bold" id="analyticsLeadsModalTitle">Daftar Kontak</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body p-0">
                    <div id="analyticsLeadsLoading" class="text-center p-5 text-muted">
                        <i class="fas fa-spinner fa-spin fa-2x mb-3"></i><br>Memuat data...
                    </div>
                    <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                        <table class="table table-hover mb-0" id="analyticsLeadsTable" style="display:none;">
                            <thead class="table-light sticky-top">
                                <tr>
                                    <th class="ps-4">Nama / Nomor</th>
                                    <th>Toko</th>
                                    <th>Terakhir Aktif</th>
                                    <th class="text-end pe-4">Aksi</th>
                                </tr>
                            </thead>
                            <tbody id="analyticsLeadsBody">
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>
`;

if (!html.includes('id="analyticsLeadsModal"')) {
    html = html.replace('</body>', modalHtml + '\n</body>');
}

// Update loadAnalytics function
const scriptStart = html.indexOf('function loadAnalytics() {');
const endOfLoadAnalytics = html.indexOf('function renderTopClosing', scriptStart);

const newLoadAnalytics = `function loadAnalytics() {
        const btn = document.querySelector('button[onclick="loadAnalytics()"]');
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Loading...';
        
        const storeId = document.getElementById('analyticsStoreFilter').value;
        const dateFilter = document.getElementById('analyticsDateFilter').value;
        
        let query = [];
        if (storeId) query.push('store_wa_id=' + storeId);
        
        if (dateFilter) {
            const today = new Date();
            today.setHours(0,0,0,0);
            
            let start, end;
            if (dateFilter === 'today') {
                start = new Date(today);
                end = new Date(today);
                end.setHours(23,59,59,999);
            } else if (dateFilter === 'yesterday') {
                start = new Date(today);
                start.setDate(start.getDate() - 1);
                end = new Date(start);
                end.setHours(23,59,59,999);
            } else if (dateFilter === '7days') {
                start = new Date(today);
                start.setDate(start.getDate() - 7);
                end = new Date();
            }
            
            if (start && end) {
                query.push('startDate=' + start.toISOString());
                query.push('endDate=' + end.toISOString());
            }
        }
        
        const qs = query.length ? '?' + query.join('&') : '';

        fetch('/api/analytics/overview' + qs)
            .then(res => res.json())
            .then(data => {
                if (btn) btn.innerHTML = '<i class="fas fa-sync-alt me-2"></i>Refresh';
                if (data.error) throw new Error(data.error);

                document.getElementById('totalLeadsAnalitik').textContent = data.summary.totalLeads;
                document.getElementById('closingRateAnalitik').textContent = data.summary.closingRate + '%';
                document.getElementById('aiHandlingRateAnalitik').textContent = data.summary.aiHandlingRate + '%';
                document.getElementById('aiHandlingSubtext').textContent = \`AI \${data.summary.aiReplies} | CS \${data.summary.csReplies}\`;
                
                const wt = data.statusBreakdown.menunggu_transfer || 0;
                document.getElementById('waitingTransferAnalitik').textContent = wt;
                if (wt > 0) document.getElementById('waitingTransferCard').classList.add('pulse-border');
                else document.getElementById('waitingTransferCard').classList.remove('pulse-border');

                renderFunnel(data.statusBreakdown, data.summary.totalLeads, qs);
                renderTrendChart(data.trend);
                renderStorePerformance(data.perStore);
                renderTopClosing(data.topClosing);
                
                document.getElementById('lastUpdateAnalitik').textContent = new Date(data.generatedAt).toLocaleTimeString('id-ID');
            })
            .catch(err => {
                if (btn) btn.innerHTML = '<i class="fas fa-sync-alt me-2"></i>Refresh';
                showToast('Gagal memuat data Analytics.', 'error');
                console.error(err);
            });
    }

    function viewAnalyticsLeads(label, qs) {
        const modal = new bootstrap.Modal(document.getElementById('analyticsLeadsModal'));
        modal.show();
        
        document.getElementById('analyticsLeadsLoading').style.display = 'block';
        document.getElementById('analyticsLeadsTable').style.display = 'none';
        
        const labelMap = {
            'closing': 'Closing / Selesai',
            'menunggu_transfer': 'Menunggu Transfer',
            'hot_lead': 'Hot Lead',
            'menunggu_rekap': 'Menunggu Rekap',
            'menunggu_alamat': 'Menunggu Alamat',
            'ai_lead_aktif': 'Tanya-tanya (Aktif)',
            'baru_masuk': 'Baru Masuk'
        };
        
        document.getElementById('analyticsLeadsModalTitle').textContent = 'Daftar Kontak: ' + (labelMap[label] || label);
        
        const q = qs ? qs + '&label=' + label : '?label=' + label;
        
        fetch('/api/analytics/leads' + q)
            .then(res => res.json())
            .then(data => {
                document.getElementById('analyticsLeadsLoading').style.display = 'none';
                document.getElementById('analyticsLeadsTable').style.display = 'table';
                
                const tbody = document.getElementById('analyticsLeadsBody');
                tbody.innerHTML = '';
                
                if (data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Tidak ada data</td></tr>';
                    return;
                }
                
                data.forEach(lead => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = \`
                        <td class="ps-4">
                            <div class="fw-bold text-dark">\${lead.contact_name}</div>
                            <div class="small text-muted">\${lead.contact_phone ? '+' + lead.contact_phone : lead.contact_id}</div>
                        </td>
                        <td><span class="badge bg-light text-dark border">\${lead.store_name}</span></td>
                        <td><div class="small text-muted"><i class="far fa-clock me-1"></i>\${formatTimeAgo(lead.last_updated)}</div></td>
                        <td class="text-end pe-4">
                            <button class="btn btn-sm btn-primary rounded-pill px-3" onclick="openChatFromAnalytics('\${lead.store_wa_id}', '\${lead.contact_id}')">Chat</button>
                        </td>
                    \`;
                    tbody.appendChild(tr);
                });
            })
            .catch(err => {
                document.getElementById('analyticsLeadsLoading').innerHTML = '<div class="text-danger">Gagal memuat data</div>';
                console.error(err);
            });
    }

    function openChatFromAnalytics(storeId, contactId) {
        bootstrap.Modal.getInstance(document.getElementById('analyticsLeadsModal')).hide();
        document.getElementById('summaryStoreFilter').value = storeId;
        switchTab('REKAP');
        setTimeout(() => {
            const chatCard = document.querySelector(\`div[onclick*="\${contactId}"]\`);
            if (chatCard) chatCard.click();
            else showToast('Mencari chat...', 'info');
        }, 500);
    }

    function renderFunnel(statusCounts, totalLeads, qs) {
        const container = document.getElementById('statusFunnelBars');
        container.innerHTML = '';

        const stages = [
            { id: 'closing', label: 'Closing / Selesai', count: statusCounts.closing || 0, color: '#10b981' },
            { id: 'menunggu_transfer', label: 'Menunggu Transfer', count: statusCounts.menunggu_transfer || 0, color: '#f59e0b' },
            { id: 'negosiasi', label: 'Hot Lead / Negosiasi', count: statusCounts.negosiasi || 0, color: '#ef4444' },
            { id: 'menunggu_rekap', label: 'Menunggu Rekap/Alamat', count: (statusCounts.menunggu_rekap || 0) + (statusCounts.menunggu_alamat || 0), color: '#3b82f6' },
            { id: 'gali_kebutuhan', label: 'Tanya-tanya (Aktif)', count: statusCounts.gali_kebutuhan || 0, color: '#6366f1' },
            { id: 'baru_masuk', label: 'Baru Masuk', count: totalLeads, color: '#94a3b8' }
        ];

        let maxCount = Math.max(...stages.map(s => s.count));
        if (maxCount === 0) maxCount = 1;

        stages.forEach(stage => {
            const percent = Math.round((stage.count / maxCount) * 100);
            const actualPercent = totalLeads > 0 ? ((stage.count / totalLeads) * 100).toFixed(1) : 0;
            
            container.innerHTML += \`
                <div class="funnel-stage" style="cursor: pointer; transition: transform 0.2s;" onclick="viewAnalyticsLeads('\${stage.id}', '\${qs}')" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='none'">
                    <div class="d-flex justify-content-between mb-1" style="font-size:0.85rem">
                        <span class="fw-semibold text-dark">\${stage.label}</span>
                        <span class="text-muted">\${stage.count} <span style="font-size:0.75rem">(\${actualPercent}%)</span></span>
                    </div>
                    <div class="progress rounded-pill bg-light" style="height: 8px;">
                        <div class="progress-bar rounded-pill" role="progressbar" 
                             style="width: \${percent}%; background-color: \${stage.color};" 
                             aria-valuenow="\${percent}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                </div>
            \`;
        });
    }

    `;

html = html.substring(0, scriptStart) + newLoadAnalytics + html.substring(endOfLoadAnalytics);

fs.writeFileSync(filePath, html);
console.log("Analytics UI updated.");
