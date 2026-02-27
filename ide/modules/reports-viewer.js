/**
 * SF-Intel Reports Viewer - v1.0.0
 * Handles D3.js and Chart.js visualizations
 */
window.ReportsViewer = {
    /**
     * Renders a D3.js force-directed dependency graph
     * @param {string} containerId - The ID of the container element
     * @param {Object} data - Graph data { nodes, links }
     */
    renderDependencyGraph(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const width = container.clientWidth || 400;
        const height = container.clientHeight || 400;

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', [0, 0, width, height]);

        const simulation = d3.forceSimulation(data.nodes)
            .force('link', d3.forceLink(data.links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2));

        const link = svg.append('g')
            .attr('stroke', '#444')
            .attr('stroke-opacity', 0.6)
            .selectAll('line')
            .data(data.links)
            .join('line')
            .attr('stroke-width', 1);

        const node = svg.append('g')
            .selectAll('circle')
            .data(data.nodes)
            .join('circle')
            .attr('r', 8)
            .attr('fill', d => this.getNodeColor(d.type))
            .attr('stroke', '#fff')
            .attr('stroke-width', 1.5)
            .call(this.drag(simulation));

        node.append('title')
            .text(d => `${d.name} (${d.type})`);

        const labels = svg.append('g')
            .selectAll('text')
            .data(data.nodes)
            .join('text')
            .text(d => d.name)
            .attr('font-size', '10px')
            .attr('fill', '#ccc')
            .attr('dx', 12)
            .attr('dy', 4);

        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('cx', d => d.x)
                .attr('cy', d => d.y);

            labels
                .attr('x', d => d.x)
                .attr('y', d => d.y);
        });

        // Add zoom
        svg.call(d3.zoom().on('zoom', (event) => {
            svg.selectAll('g').attr('transform', event.transform);
        }));
    },

    /**
     * Renders an advanced cross-class relationship graph (Phase 5)
     * @param {string} containerId - The ID of the container element
     * @param {Object} data - Relationship data from /api/class-relationships
     */
    renderAdvancedRelationshipGraph(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const width = container.clientWidth || 600;
        const height = container.clientHeight || 400;

        const nodes = [];
        const links = [];

        // 1. Add Current Class (Center)
        const currentId = `node_${data.current_class}`;
        nodes.push({
            id: currentId,
            name: data.current_class,
            type: 'Target',
            fx: width / 2,
            fy: height / 2,
            metrics: data.metrics
        });

        // 2. Add Consumers (Top)
        // Adjust spacing for side panel if few consumers
        const consumerSpacing = width / (data.called_by.length + 1);
        data.called_by.forEach((rel, i) => {
            const id = `node_${rel.class_name}`;
            nodes.push({
                id: id,
                name: rel.class_name,
                type: 'Consumer',
                fx: consumerSpacing * (i + 1),
                fy: height * 0.25,
                callCount: rel.call_count,
                methods: rel.methods
            });
            links.push({
                source: id,
                target: currentId,
                type: 'CALLS',
                count: rel.call_count
            });
        });

        // 3. Add Dependencies (Bottom)
        const dependencySpacing = width / (data.depends_on.length + 1);
        data.depends_on.forEach((rel, i) => {
            const id = `node_${rel.class_name}`;
            nodes.push({
                id: id,
                name: rel.class_name,
                type: 'Dependency',
                fx: dependencySpacing * (i + 1),
                fy: height * 0.75,
                callCount: rel.call_count,
                methods: rel.methods
            });
            links.push({
                source: currentId,
                target: id,
                type: 'DEPENDS_ON',
                count: rel.call_count
            });
        });

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', [0, 0, width, height]);

        // Markers for arrows
        svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 22) // Increased offset for smaller nodes if needed
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', 5)
            .attr('markerHeight', 5)
            .attr('xoverflow', 'visible')
            .append('svg:path')
            .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
            .attr('fill', '#666')
            .style('stroke', 'none');

        const g = svg.append('g');

        const link = g.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', d => d.type === 'CALLS' ? '#10b981' : '#f59e0b')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', d => Math.min(Math.sqrt(d.count) + 1, 4))
            .attr('marker-end', 'url(#arrowhead)');

        const node = g.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .attr('class', 'node-group')
            .style('cursor', 'pointer');

        // Smaller rectangles for side panel
        const nodeWidth = width < 400 ? 100 : 120;
        const nodeHeight = 32;

        node.append('rect')
            .attr('width', nodeWidth)
            .attr('height', nodeHeight)
            .attr('x', -nodeWidth / 2)
            .attr('y', -nodeHeight / 2)
            .attr('rx', 4)
            .attr('fill', d => {
                if (d.type === 'Target') return '#3b82f6';
                if (d.type === 'Consumer') return '#10b981';
                return '#f59e0b';
            })
            .attr('stroke', '#fff')
            .attr('stroke-width', d => d.type === 'Target' ? 2 : 1);

        node.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', 4)
            .attr('fill', '#fff')
            .attr('font-size', width < 400 ? '9px' : '10px')
            .attr('font-weight', 'bold')
            .text(d => d.name.length > 15 ? d.name.substring(0, 12) + '...' : d.name);

        node.append('title')
            .text(d => {
                let txt = `${d.name} (${d.type})\n`;
                if (d.methods) txt += `Methods: ${d.methods.join(', ')}`;
                if (d.metrics) txt += `Coupling: ${d.metrics.coupling_score.toFixed(2)}`;
                return txt;
            });

        // Add tick for simulation
        const simulation = d3.forceSimulation(nodes)
            .on('tick', () => {
                link
                    .attr('x1', d => d.source.x)
                    .attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x)
                    .attr('y2', d => d.target.y);

                node.attr('transform', d => `translate(${d.x},${d.y})`);
            });

        svg.call(d3.zoom().on('zoom', (event) => {
            g.attr('transform', event.transform);
        }));
    },

    /**
     * Renders a Chart.js audit dashboard
     * @param {string} canvasId - The ID of the canvas element
     * @param {Object} data - Audit statistics
     */
    renderAuditChart(canvasId, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        if (!ctx) return;

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Excellent', 'Good', 'Fair', 'Poor', 'Critical'],
                datasets: [{
                    label: 'Query Distribution',
                    data: [
                        data.excellent_count,
                        data.good_count,
                        data.fair_count,
                        data.poor_count,
                        data.critical_count
                    ],
                    backgroundColor: [
                        '#27ae60', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#333' } },
                    x: { grid: { display: false } }
                }
            }
        });
    },

    /**
     * Renders a D3.js Sunburst chart for architectural roles
     * @param {string} containerId - The ID of the container element
     * @param {Object} data - Role distribution data
     */
    renderRolesSunburst(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const width = container.clientWidth || 400;
        const height = container.clientHeight || 400;
        const radius = Math.min(width, height) / 2;

        // Transform flat data to hierarchical
        const hierarchyData = {
            name: "Architecture",
            children: Object.entries(data)
                .filter(([key]) => key !== 'total')
                .map(([key, list]) => ({
                    name: key.replace('_', ' '),
                    children: list.map(name => ({ name, value: 1 }))
                }))
                .filter(cat => cat.children.length > 0)
        };

        const partition = data => {
            const root = d3.hierarchy(data)
                .sum(d => d.value)
                .sort((a, b) => b.value - a.value);
            return d3.partition()
                .size([2 * Math.PI, root.height + 1])(root);
        };

        const color = d3.scaleOrdinal(d3.quantize(d3.interpolateRainbow, hierarchyData.children.length + 1));
        const format = d3.format(",d");
        const arc = d3.arc()
            .startAngle(d => d.x0)
            .endAngle(d => d.x1)
            .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
            .padRadius(radius / 3)
            .innerRadius(d => d.y0 * radius / 3)
            .outerRadius(d => Math.max(d.y0 * radius / 3, d.y1 * radius / 3 - 1));

        const root = partition(hierarchyData);
        root.each(d => d.current = d);

        const svg = d3.select(`#${containerId}`).append("svg")
            .attr("viewBox", [0, 0, width, height])
            .attr("style", "max-width: 100%; height: auto; height: intrinsic;")
            .append("g")
            .attr("transform", `translate(${width / 2},${height / 2})`);

        const path = svg.append("g")
            .selectAll("path")
            .data(root.descendants().slice(1))
            .join("path")
            .attr("fill", d => { while (d.depth > 1) d = d.parent; return color(d.data.name); })
            .attr("fill-opacity", d => arcVisible(d.current) ? (d.children ? 0.6 : 0.4) : 0)
            .attr("pointer-events", d => arcVisible(d.current) ? "auto" : "none")
            .attr("d", d => arc(d.current));

        path.append("title")
            .text(d => `${d.ancestors().map(d => d.data.name).reverse().join("/")}\n${format(d.value)}`);

        const label = svg.append("g")
            .attr("pointer-events", "none")
            .attr("text-anchor", "middle")
            .attr("style", "user-select: none;")
            .selectAll("text")
            .data(root.descendants().slice(1))
            .join("text")
            .attr("dy", "0.35em")
            .attr("fill", "#eee")
            .attr("font-size", "10px")
            .attr("fill-opacity", d => +labelVisible(d.current))
            .attr("transform", d => labelTransform(d.current))
            .text(d => d.data.name);

        const centerLabel = svg.append("text")
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .attr("font-weight", "bold")
            .attr("font-size", "14px")
            .text(data.total);

        centerLabel.append("tspan")
            .attr("x", 0)
            .attr("dy", "1.2em")
            .attr("font-size", "10px")
            .attr("fill", "#888")
            .text("CLASSES");

        function arcVisible(d) {
            return d.y1 <= 3 && d.y0 >= 1 && d.x1 > d.x0;
        }

        function labelVisible(d) {
            return d.y1 <= 3 && d.y0 >= 1 && (d.y1 - d.y0) * (d.x1 - d.x0) > 0.03;
        }

        function labelTransform(d) {
            const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
            const y = (d.y0 + d.y1) / 2 * radius / 3;
            return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
        }
    },

    getNodeColor(type) {
        switch(type) {
            case 'Class': case 'ApexClass': return '#4facfe';
            case 'Trigger': case 'ApexTrigger': return '#f093fb';
            case 'Aura': return '#ffd1ff';
            case 'LWC': return '#5ee7df';
            default: return '#ccc';
        }
    },

    drag(simulation) {
        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }
        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }
        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }
        return d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended);
    },

    /**
     * Renders a method execution flow tree (Phase 5)
     * @param {string} containerId - The ID of the container element
     * @param {Array} treeData - Flow nodes array
     */
    renderFlowTree(containerId, treeData) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const width = container.clientWidth || 600;
        const height = container.clientHeight || 500;
        const margin = { top: 20, right: 120, bottom: 20, left: 40 };

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', [0, 0, width, height]);

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Convert flat children to hierarchy
        const root = d3.hierarchy({ name: 'Execution Root', children: treeData });
        
        const tree = d3.tree().size([height - margin.top - margin.bottom, width - margin.left - margin.right]);
        tree(root);

        // Nodes
        const node = g.selectAll('.node')
            .data(root.descendants())
            .join('g')
            .attr('class', d => `node ${d.children ? ' node--internal' : ' node--leaf'}`)
            .attr('transform', d => `translate(${d.y},${d.x})`);

        // Links
        g.selectAll('.link')
            .data(root.links())
            .join('path')
            .attr('class', 'link')
            .attr('fill', 'none')
            .attr('stroke', '#4facfe')
            .attr('stroke-opacity', 0.4)
            .attr('stroke-width', 1.5)
            .attr('d', d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x));

        node.append('circle')
            .attr('r', d => d.data.node_type === 'method' ? 4 : 3)
            .attr('fill', d => {
                if (d.data.node_type === 'soql') return '#f1c40f';
                if (d.data.node_type === 'dml') return '#e74c3c';
                if (d.data.node_type === 'callout') return '#9b59b6';
                return '#4facfe';
            });

        node.append('text')
            .attr('dy', '0.31em')
            .attr('x', d => d.children ? -8 : 8)
            .attr('text-anchor', d => d.children ? 'end' : 'start')
            .text(d => d.data.name)
            .attr('fill', '#ccc')
            .attr('font-size', '10px')
            .clone(true).lower()
            .attr('stroke', '#1a1a1b')
            .attr('stroke-width', 3);

        svg.call(d3.zoom().on('zoom', (event) => {
            g.attr('transform', `translate(${event.transform.x + margin.left},${event.transform.y + margin.top}) scale(${event.transform.k})`);
        }));
    }
};
