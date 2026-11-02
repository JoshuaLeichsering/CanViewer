// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { useI18n } from '../lib/i18n';
import { hexId } from '../lib/format';
import { Icon } from './Icon';

interface GraphLink {
  from: string;
  to: string;
  messages: DbcMessage[];
}

interface GraphData {
  /** Nodes participating in at least one link, in layout order. */
  nodes: string[];
  links: GraphLink[];
  /** BU_ nodes without any sender/receiver relationship. */
  isolated: string[];
  /** Messages that produced no link (no sender and/or no receivers). */
  unroutedMessages: number;
}

function buildGraph(db: DbcDatabase): GraphData {
  const linkMap = new Map<string, GraphLink>();
  const connected = new Set<string>();
  let unrouted = 0;

  for (const message of db.messages) {
    const senders = [message.sender, ...message.transmitters].filter((s) => s !== '');
    const receivers = [...new Set(message.signals.flatMap((s) => s.receivers))];
    let produced = false;
    for (const from of senders) {
      for (const to of receivers) {
        if (from === to) continue;
        const key = `${from}\u0000${to}`;
        let link = linkMap.get(key);
        if (!link) {
          link = { from, to, messages: [] };
          linkMap.set(key, link);
        }
        link.messages.push(message);
        connected.add(from);
        connected.add(to);
        produced = true;
      }
    }
    if (!produced) unrouted++;
  }

  const known = db.nodes.map((n) => n.name);
  // Receivers/senders that are not declared in BU_ still take part in traffic.
  const extra = [...connected].filter((n) => !known.includes(n)).sort();
  return {
    nodes: [...known.filter((n) => connected.has(n)), ...extra],
    links: [...linkMap.values()],
    isolated: known.filter((n) => !connected.has(n)),
    unroutedMessages: unrouted,
  };
}

const W = 760;
const H = 520;
const NODE_R = 18;

interface Point {
  x: number;
  y: number;
  angle: number;
}

function edgeGeometry(p1: Point, p2: Point) {
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Curve to the left of the travel direction so A->B and B->A separate.
  const nx = -dy / dist;
  const ny = dx / dist;
  const k = Math.min(46, dist * 0.18);
  const cx = mx + nx * k;
  const cy = my + ny * k;
  const sd = Math.hypot(cx - p1.x, cy - p1.y) || 1;
  const ed = Math.hypot(p2.x - cx, p2.y - cy) || 1;
  const sx = p1.x + ((cx - p1.x) / sd) * NODE_R;
  const sy = p1.y + ((cy - p1.y) / sd) * NODE_R;
  const ex = p2.x - ((p2.x - cx) / ed) * (NODE_R + 7);
  const ey = p2.y - ((p2.y - cy) / ed) * (NODE_R + 7);
  return {
    d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
    labelX: mx + nx * k * 0.8,
    labelY: my + ny * k * 0.8,
  };
}

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

export function NetworkGraph({
  db,
  fileName,
  onSelect,
}: {
  db: DbcDatabase;
  fileName: string;
  onSelect: (s: Selection) => void;
}) {
  const { t, tn } = useI18n();
  const graph = useMemo(() => buildGraph(db), [db]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphLink | null>(null);

  // On narrow screens the graph scrolls sideways in its card (narrow.css):
  // start in the middle of the ring rather than at its left edge.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (card) card.scrollLeft = (card.scrollWidth - card.clientWidth) / 2;
  }, [graph]);

  const positions = useMemo(() => {
    const map = new Map<string, Point>();
    const radius = Math.min(W, H) / 2 - 70;
    graph.nodes.forEach((name, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / graph.nodes.length;
      map.set(name, { x: W / 2 + radius * Math.cos(angle), y: H / 2 + radius * Math.sin(angle), angle });
    });
    return map;
  }, [graph]);

  const focusNode = hovered ?? selectedNode;
  const hasFocus = focusNode !== null || selectedEdge !== null;

  const edgeState = (link: GraphLink): 'hi' | 'dim' | '' => {
    if (selectedEdge === link) return 'hi';
    if (focusNode !== null && (link.from === focusNode || link.to === focusNode)) return 'hi';
    return hasFocus ? 'dim' : '';
  };

  const nodeState = (name: string): 'sel' | 'dim' | '' => {
    if (name === focusNode) return 'sel';
    if (selectedEdge && (selectedEdge.from === name || selectedEdge.to === name)) return 'sel';
    if (!hasFocus) return '';
    if (focusNode !== null) {
      const related = graph.links.some(
        (l) => (l.from === focusNode && l.to === name) || (l.to === focusNode && l.from === name),
      );
      return related ? '' : 'dim';
    }
    return 'dim';
  };

  const selectMessage = (m: DbcMessage) => onSelect({ kind: 'message', rawId: m.rawId, occ: occurrenceOf(db, m) });
  const selectEdge = (link: GraphLink) => {
    setSelectedEdge(link);
    setSelectedNode(null);
  };

  const header = (
    <header className="page-header">
      <div className="overline">{t('networkOverline', { file: fileName })}</div>
      <h1>{t('ecuNetwork')}</h1>
      <p className="lead">{graph.nodes.length === 0 ? t('graphEmpty') : t('graphHint')}</p>
    </header>
  );
  if (graph.nodes.length === 0) return header;

  const edges = graph.links.map((link) => {
    const geo = edgeGeometry(positions.get(link.from)!, positions.get(link.to)!);
    return { link, geo, state: edgeState(link), width: Math.min(1 + link.messages.length * 0.35, 5) };
  });

  return (
    <div className="network-view">
      {header}
      <div className="row">
        <div className="card graph-card" ref={cardRef}>
          <div className="graph-area">
            <div className="graph-wrap">
              <svg
                className="netgraph"
                viewBox={`0 0 ${W} ${H}`}
                onClick={() => {
                  setSelectedNode(null);
                  setSelectedEdge(null);
                }}
              >
                {/* Arrowheads in graph units, so that they keep their size on thick lines. */}
                <defs>
                  <marker id="ng-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className="ng-arrow" />
                  </marker>
                  <marker id="ng-arrow-hi" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className="ng-arrow hi" />
                  </marker>
                </defs>
                {edges.map(({ link, geo, state, width }) => (
                  <g key={`${link.from}\u0000${link.to}`}>
                    <path
                      d={geo.d}
                      className="ng-hit"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectEdge(link);
                      }}
                    >
                      <title>
                        {tn('edgeTitleOne', 'edgeTitleMany', link.messages.length, { from: link.from, to: link.to })}
                      </title>
                    </path>
                    <path
                      d={geo.d}
                      className={`ng-edge ${state}`}
                      strokeWidth={state === 'hi' ? Math.max(width, 2) : width}
                      markerEnd={state === 'hi' ? 'url(#ng-arrow-hi)' : 'url(#ng-arrow)'}
                    />
                  </g>
                ))}
                {graph.nodes.map((name) => {
                  const p = positions.get(name)!;
                  const select = () => {
                    setSelectedNode(name);
                    setSelectedEdge(null);
                  };
                  return (
                    <g
                      key={name}
                      className={`ng-node ${nodeState(name)}`}
                      tabIndex={0}
                      role="button"
                      aria-label={name}
                      aria-pressed={selectedNode === name}
                      onMouseEnter={() => setHovered(name)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(name)}
                      onBlur={() => setHovered(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        select();
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        select();
                      }}
                    >
                      <circle cx={p.x} cy={p.y} r={NODE_R} />
                      <title>{name}</title>
                    </g>
                  );
                })}
              </svg>
              {/* Labels as HTML so they use the app font and stay crisp at any size. */}
              {graph.nodes.map((name) => {
                const p = positions.get(name)!;
                const cos = Math.cos(p.angle);
                const sin = Math.sin(p.angle);
                const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
                const lx = p.x + (NODE_R + 9) * cos;
                const ly = p.y + (NODE_R + 9) * sin + (anchor === 'middle' ? (sin > 0 ? 12 : -4) : 4);
                const tx = anchor === 'start' ? '0' : anchor === 'end' ? '-100%' : '-50%';
                return (
                  <span
                    key={name}
                    className={`ng-label ${nodeState(name) === 'dim' ? 'dim' : ''}`}
                    style={{ left: pct(lx, W), top: pct(ly, H), transform: `translate(${tx}, -75%)` }}
                  >
                    {name}
                  </span>
                );
              })}
              {edges
                .filter((e) => e.state === 'hi')
                .map(({ link, geo }) => (
                  <span
                    key={`c${link.from}\u0000${link.to}`}
                    className="ng-count"
                    style={{ left: pct(geo.labelX, W), top: pct(geo.labelY, H) }}
                  >
                    {link.messages.length}
                  </span>
                ))}
            </div>
          </div>
          {(graph.isolated.length > 0 || graph.unroutedMessages > 0) && (
            <div className="graph-note">
              {graph.isolated.length > 0 && (
                <>
                  {t('notConnected')} {graph.isolated.join(', ')}.{' '}
                </>
              )}
              {graph.unroutedMessages > 0 && tn('unroutedOne', 'unroutedMany', graph.unroutedMessages)}
            </div>
          )}
        </div>

        <div className="card side-card">
          {selectedEdge ? (
            <>
              <div className="card-overline">{t('connectionLabel')}</div>
              <h2 className="side-title">
                {selectedEdge.from} → {selectedEdge.to}
              </h2>
              <div className="muted" style={{ marginBottom: 12 }}>
                {tn('messagesOne', 'messagesMany', selectedEdge.messages.length)}
              </div>
              {selectedEdge.messages.map((m) => (
                <button key={`${m.rawId}.${occurrenceOf(db, m)}`} className="msg-row state" onClick={() => selectMessage(m)}>
                  <span className="id">{hexId(m.id, m.isExtended)}</span>
                  <span className="name">{m.name}</span>
                  <Icon name="chevron_right" size={20} />
                </button>
              ))}
            </>
          ) : selectedNode ? (
            <NodeLinks
              name={selectedNode}
              links={graph.links}
              onSelectEdge={selectEdge}
              onOpenNode={
                db.nodes.some((n) => n.name === selectedNode)
                  ? () => onSelect({ kind: 'node', name: selectedNode })
                  : undefined
              }
            />
          ) : (
            <div className="empty-hint">
              <Icon name="touch_app" size={22} />
              {t('graphClickHint')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeLinks({
  name,
  links,
  onSelectEdge,
  onOpenNode,
}: {
  name: string;
  links: GraphLink[];
  onSelectEdge: (l: GraphLink) => void;
  onOpenNode?: () => void;
}) {
  const { t, tn } = useI18n();
  const outgoing = links.filter((l) => l.from === name);
  const incoming = links.filter((l) => l.to === name);
  return (
    <>
      <div className="card-overline">{t('ecuLabel')}</div>
      <div className="side-head">
        <h2>{name}</h2>
        {onOpenNode && (
          <button className="btn tonal state" onClick={onOpenNode}>
            {t('openNode')}
          </button>
        )}
      </div>
      <div className="side-sub">{t('sendsToLabel')}</div>
      {outgoing.length === 0 && (
        <div className="muted" style={{ padding: '0 8px' }}>
          {t('nothing')}
        </div>
      )}
      {outgoing.map((l) => (
        <button key={l.to} className="link-row state" onClick={() => onSelectEdge(l)}>
          <span>→ {l.to}</span>
          <span className="count">{tn('msgCountOne', 'msgCountMany', l.messages.length)}</span>
        </button>
      ))}
      <div className="side-sub" style={{ marginTop: 12 }}>
        {t('receivesFromLabel')}
      </div>
      {incoming.length === 0 && (
        <div className="muted" style={{ padding: '0 8px' }}>
          {t('nothing')}
        </div>
      )}
      {incoming.map((l) => (
        <button key={l.from} className="link-row state" onClick={() => onSelectEdge(l)}>
          <span>← {l.from}</span>
          <span className="count">{tn('msgCountOne', 'msgCountMany', l.messages.length)}</span>
        </button>
      ))}
    </>
  );
}
