/*
 * ARENAS por equipos (1v1 / 2v2 / 3v3) y AMIGOS — cliente.
 *
 * Dos paneles separados:
 *  - ARENAS: la lista de salas (1V1, 2V2, 3V3). Ves las salas que ha creado la gente y puedes
 *    UNIRTE, o crear la tuya pulsando una sala vacia, o dar a PARTIDA RAPIDA. Al buscar sale
 *    "BUSCANDO" con la opcion de jugar una practica mientras esperas (no se mete a nadie en
 *    partida sin querer).
 *  - AMIGOS: lista con presencia, susurros y el GRUPO. Desde aqui se invita a los amigos y asi se
 *    forma el grupo (1 a 3) con el que luego se entra a las salas. Un grupo de 2 va a salas 2V2.
 *
 * La identidad es la cuenta del airdrop: wallet o X, da igual cual (con X se ve su usuario y
 * foto; con solo la wallet, su resumen). Protocolo y reglas: server/squad.js y server/social.js.
 *
 * Una sola UI para PC y app: render() pinta dentro de los contenedores montados. En la app van
 * dentro de los paneles del hub (app-hub.js); en PC, en carteles propios (#sqPc, #sqPcFr).
 * El tamano se escala con `em`, asi que cada sitio fija su font-size.
 */
(function () {
    'use strict';
    const SIZES = [1, 2, 3];
    const SLOTS = 3;   // tarjetas por columna en la lista de salas
    const S = {
        ws: null, conn: 'idle', party: null, me: null, err: '', note: '',
        box: { rooms: null, friends: null }, pc: {}, roster: null, rel: null,
        ticketTimer: null, practiceTimer: null, enterBusy: false, after: null,
        x: 'unknown', token: null, prof: null, idAt: 0,
        friends: { friends: [], inReq: [], outReq: [] }, rooms: [], chat: {}, chatWith: null, unread: {}, roomsTimer: null,
    };
    const EN_APP = document.documentElement.classList.contains('pw-app');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const snd = n => { try { SoundManager.play(n); } catch (e) {} };
    const ERRS = {
        no_party: 'That group is gone.', party_full: 'That group is full (3 players).', party_busy: "You can't do that while your group is searching.",
        not_leader: 'Only the group leader can do that.', size_mismatch: 'Your group size does not match that room.', already_in_party: 'You are already in a group.',
        bad_token: 'Could not verify your account. Reopen this panel.', need_x: 'Connect your wallet to use friends.',
        no_such_user: 'Nobody with that X name or wallet has opened Arenas yet.', self: "That's you!", already_friends: 'You are already friends.',
        already_requested: 'Request already sent.', friends_full: 'Friends list is full.', requests_full: 'That player has too many pending requests.',
        no_request: 'That request is gone.', not_friends: 'You can only do that with friends.', no_open_party: 'Invite a friend first.',
        offline: 'That friend is offline.', slow_down: 'Slow down a little.', room_gone: 'That room is no longer available.',
    };
    const ST = { on: 'ONLINE', party: 'IN A GROUP', game: 'IN A MATCH', off: 'OFFLINE' };
    // Como se ve a alguien en grupos y amigos: su @ de X o, sin X, el resumen de su wallet. (El nombre que pone en THE PILL solo
    // sale sobre su pildora en el mapa.) A los amigos se les puede poner un apodo, solo tuyo.
    const nameOf = o => (o.u ? '@' + o.u : (o.n || 'PLAYER'));
    let nicks = {}; try { nicks = JSON.parse(localStorage.getItem('pw_nicks')) || {}; } catch (e) { nicks = {}; }
    const friendName = o => nicks[o.id] || nameOf(o);
    function setNick(id, v) {
        v = String(v || '').replace(/[<>]/g, '').trim().slice(0, 16);
        if (v) nicks[id] = v; else delete nicks[id];
        try { localStorage.setItem('pw_nicks', JSON.stringify(nicks)); } catch (e) {}
    }
    const initial = o => esc(String(o.u || o.n || '?').replace(/^@/, '').slice(0, 1).toUpperCase());

    const css = `
/* En el movil el juego se gira por CSS (--pw-largo/--pw-corto): todo lo que cuelga de body y no va dentro de un contenedor
   girado sale tumbado. Los carteles de arenas viven en este marco, que se gira igual que #loadingScreen. */
#sqFrame{position:fixed;inset:0;z-index:9990;pointer-events:none}
@media (pointer: coarse){html:not([data-hero]) body.mobile-allowed #sqFrame{inset:auto;width:100vh;height:100vw;width:var(--pw-largo,100dvh);height:var(--pw-corto,100dvw);top:50%;left:50%;transform:translate(-50%,-50%) rotate(90deg);transform-origin:center}}
.sq{font-family:'Press Start 2P',monospace;color:#fff;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.8em;padding:.4em .8em .2em}
.sq *{box-sizing:border-box}
.sq-t{font-size:.9em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000;letter-spacing:.06em}
.sq-p{font-size:.4em;line-height:2;color:#cfd8d3;max-width:38em}
.sq-row{display:flex;gap:.8em;align-items:center;justify-content:center;flex-wrap:wrap;width:100%}
.sq-b{font-family:'Russo One',sans-serif;font-size:.74em;letter-spacing:.1em;padding:.6em 1.2em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer;min-width:5.6em}
.sq-b.sm{font-size:.5em;padding:.45em .9em;min-width:0}
.sq-b.on{background:var(--ac,#00ff88);border-color:var(--ac,#00ff88);color:#04150c}
.sq-b.gold{background:#ffd23a;border-color:#ffd23a;color:#241a00}
.sq-b.red{border-color:#7a2a26;color:#ff8a7a}
.sq-b:disabled{opacity:.35;cursor:default}
.sq-b:active:not(:disabled){transform:translateY(.1em)}
.sq-in{font-family:'Press Start 2P',monospace;font-size:.5em;color:#fff;background:#050c09;border:.2em solid #2c3630;padding:1em .9em;outline:none;width:100%;letter-spacing:.02em}
.sq-in:focus{border-color:var(--ac,#00ff88)}
.sq-lab{font-size:.36em;color:#7d8a82;letter-spacing:.14em}
.sq-err{font-size:.4em;color:#ff6a5a;min-height:1.6em;line-height:1.8}
.sq-ok{color:#00ff66}
.sq-q{font-size:.6em;color:#9bbfff;letter-spacing:.1em;animation:sqB 1s steps(2) infinite}
@keyframes sqB{50%{opacity:.35}}
.sq-note{font-size:.38em;line-height:2;color:#8aa096;max-width:36em}
.sq-pic{width:2.2em;height:2.2em;border-radius:50%;object-fit:cover;background:#16201b;box-shadow:0 0 0 .12em #000;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:.8em;color:#7d8a82}
/* grupo: foto y nombre debajo */
.sq-grp{display:flex;gap:1.2em;justify-content:center;align-items:flex-start;width:100%}
.sq-av{display:flex;flex-direction:column;align-items:center;gap:.6em;width:7em}
.sq-av .sq-pic{width:3.4em;height:3.4em;font-size:1.1em}
.sq-av .n{font-size:.42em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-av.me .sq-pic{box-shadow:0 0 0 .16em var(--ac,#00ff88)}
.sq-av .l{font-size:.32em;color:#ffd23a;letter-spacing:.1em;margin-top:-.3em}
.sq-av.empty .sq-pic{background:none;border:.14em dashed #34423a;box-shadow:none}
.sq-pic{overflow:hidden}
#ahArBody{height:15.5em;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;justify-content:center}   /* mismo alto siempre: el panel no cambia de tamano al cambiar de pantalla */
#ahArBody>.sq{width:100%;box-sizing:border-box}
#ahFrBody{height:15.5em;overflow-y:auto}
.sq-tabs{display:flex;gap:.5em;width:100%}
.sq.sq-fixed{height:100%;box-sizing:border-box;justify-content:flex-start}
.sq-tab{flex:1;font-family:inherit;font-size:.5em;letter-spacing:.1em;padding:.7em;background:none;border:.14em solid #2f3d35;color:#7d8a82;cursor:pointer}
.sq-tab.on{border-color:var(--ac,#00ff88);color:var(--ac,#00ff88)}
.sq-tab:disabled{opacity:.35}
.sq-gw{flex:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:0}   /* el panel no se sale de la pantalla: con grupo la lista hace scroll dentro */
/* amigos: la lista usa todo el alto del panel (si no, con 3 amigos el tercero quedaba cortado) y las filas son mas bajas */
#ahFrBody .sq-list{max-height:none;overflow:visible;gap:.4em}
#ahFrBody .sq-it{padding:.3em .7em}
#ahFrBody .sq-it .sq-pic{width:1.8em;height:1.8em}
.sq-pic .av,.sq-pic .av-cv{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center}
.sq-pic .av svg{width:60%;height:60%}
.sq-pic canvas{image-rendering:pixelated}
/* buscando: los jugadores son lo central, grandes, y los botones van abajo */
.sq.find{min-height:13.5em;justify-content:space-between;gap:.6em}
.sq.find .mid{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8em;width:100%}
.sq-grp.big{flex:none;align-items:center;gap:2.6em}
/* en AMIGOS el grupo es una tira compacta: si no, con tres jugadores el panel se sale de la pantalla */
.sq-grp.small{gap:.8em}
.sq-grp.small .sq-av{width:6.2em;gap:.4em}
.sq-grp.small .sq-av .sq-pic{width:2.5em;height:2.5em;font-size:1em}
.sq-grp.small .sq-av .n{font-size:.4em}
.sq-grp.big .sq-av{width:12em;gap:.9em}
.sq-grp.big .sq-av .sq-pic{width:4.6em;height:4.6em;font-size:1.4em}
.sq-grp.big .sq-av .n{font-size:.55em}
.sq-grp.big .sq-av .l{font-size:.36em}
.sq-bot{display:flex;flex-direction:column;align-items:center;gap:.8em;width:100%}
.sq.find .sq-bot{margin-bottom:0}
.sq-err:empty{display:none}
/* FIN DE PARTIDA (diseno C): fondo oscuro, banda en diagonal, VICTORY verde / DEFEAT rojo */
#sqEnd{font-size:min(1.25vmax,2.7vmin);position:absolute;inset:0;z-index:300;pointer-events:auto;display:none;font-family:'Press Start 2P',monospace;color:#fff;overflow:hidden;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.04) 0 0.2em,transparent 0.2em 4em),#2a0d14;--ec:#ff4d6d}
#sqEnd.win{background-color:#0b2416;--ec:#00ff88}
#sqEnd.draw{background-color:#241f0b;--ec:#ffd23a}
#sqEnd.n3 .rw{margin-bottom:.15em}#sqEnd.n3 .rw .ph .sq-pic{width:2.5em;height:2.5em}#sqEnd.n3 .h{margin:.2em 0 .3em}#sqEnd.n3 .rw .k,#sqEnd.n3 .rw .pk{font-size:1.6em}
#sqEnd:before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 0.2em,transparent 0.2em 4em)}
#sqEnd.show{display:block}
#sqEnd canvas.fx{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none;z-index:0}
#sqEnd .band{z-index:1}#sqEnd .bts{z-index:2}
#sqEnd .band{position:absolute;left:-4%;right:-4%;top:27%;height:58%;background:#0b0f05;transform:rotate(-4deg);border-top:0.7em solid var(--ec);border-bottom:0.7em solid var(--ec)}
#sqEnd .t{position:absolute;left:0;right:0;top:-36%;text-align:center;font-size:5.6em;color:var(--ec);-webkit-text-stroke:.07em #0b0f05;paint-order:stroke fill;text-shadow:.125em .125em 0 #0b0f05;animation:seT .5s cubic-bezier(.2,1.4,.3,1) both}
#sqEnd .cols{position:absolute;inset:5% 8% 6% 9%;display:flex;gap:4%;align-items:flex-start}
#sqEnd .tms{flex:1.25;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:space-evenly}
#sqEnd .h{font-size:0.9em;margin:0.6em 0 0.8em}#sqEnd .h.me{color:#3fa0ff}#sqEnd .h.foe{color:#ff6a5a}
#sqEnd .rw{display:flex;align-items:center;gap:1.2em;margin-bottom:.55em}
#sqEnd .rw.dead{opacity:.55}
#sqEnd .rw .ph .sq-pic{width:3.5em;height:3.5em;border-radius:0;box-shadow:0 0 0 0.3em #3fa0ff,0.3em 0.3em 0 0.3em #000}
#sqEnd .rw .ph.foe .sq-pic{box-shadow:0 0 0 0.3em #ff6a5a,0.3em 0.3em 0 0.3em #000}
#sqEnd .rw .nm{width:34%;font-size:1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#sqEnd .rw .k{font-family:'VT323',monospace;font-size:1.9em;color:#ffce3d;width:22%;white-space:nowrap}
#sqEnd .rw .pk{font-family:'VT323',monospace;font-size:1.9em;color:#e8e8e8;white-space:nowrap}
#sqEnd .prz{flex:1;text-align:center;padding-top:5%}
#sqEnd .pt{font-size:1.1em;margin-bottom:1.4em}
#sqEnd .pd{font-family:'VT323',monospace;font-size:2.2em;line-height:1.15;color:#e8e8e8}#sqEnd .pd b{font-weight:400;color:#ffce3d}
#sqEnd .bts{position:absolute;left:0;right:0;bottom:4%;display:flex;justify-content:center;gap:1.6em}
#sqEnd .bts button{font-family:'Press Start 2P',monospace;font-size:1.4em;width:11.5em;height:3.2em;display:inline-flex;align-items:center;justify-content:center;border:.25em solid #ccff00;background:#ccff00;color:#0b0f05;box-shadow:.3em .3em 0 rgba(0,0,0,.45);cursor:pointer}   /* los dos botones del mismo tamano y el mismo borde */
#sqEnd .rw .pk.bot{text-decoration:line-through;text-decoration-color:#ff4d6d;text-decoration-thickness:.12em;color:#ff8a9a}
#sqEnd .bts button.o{background:#0b0f05;color:#e8e8e8;border-color:#e8e8e8}
@keyframes seT{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
/* ENTRADA A LA PARTIDA (diseno C animado) */
.ci{font-size:min(1.25vmax,2.7vmin);position:absolute;inset:0;overflow:hidden;font-family:'Press Start 2P',monospace;color:#fff;
  background:repeating-linear-gradient(0deg,rgba(11,15,5,.12) 0 0.2em,transparent 0.2em 4em),#ccff00;animation:ciIn .3s both}
.ci:before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(11,15,5,.12) 0 0.2em,transparent 0.2em 4em)}
.ci .bd{position:absolute;left:-6%;right:-6%;height:36%;background:#0b0f05;transform:rotate(-4deg)}
.ci .bd.ba{top:13%;border-top:0.6em solid #1d9bf0;animation:ciL .5s .15s cubic-bezier(.2,.9,.3,1) both}
.ci .bd.bb{top:55%;border-top:0.6em solid #ff4d6d;animation:ciR .5s 1.45s cubic-bezier(.2,.9,.3,1) both}
.ci .row{position:absolute;left:12%;top:8%;display:flex;gap:4%;width:56%}
.ci .ti{display:flex;flex-direction:column;align-items:center;gap:0.8em;width:24%;animation:ciPop .35s cubic-bezier(.2,1.4,.3,1) both}
.ci .ti .sq-pic{width:11em;height:11em;border-radius:0}
.ci .ti.me .sq-pic{box-shadow:0 0 0 0.5em #1d9bf0,0.6em 0.6em 0 0.5em #000,0 0 2.2em rgba(29,155,240,.5)}
.ci .ti.foe .sq-pic{box-shadow:0 0 0 0.5em #ff4d6d,0.6em 0.6em 0 0.5em #000,0 0 2.2em rgba(255,77,109,.5)}
.ci .ti .nm{font-size:0.9em;text-shadow:0.2em 0.2em 0 #000;max-width:120%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci .pl4{position:absolute;right:12%;top:30%;display:flex;gap:1.6em}
.ci .pl4 i{display:block;width:1.6em;height:3.2em;border-radius:0.9em;transform:rotate(-45deg);box-shadow:0 0 0 0.2em #000}
.ci .pl4.pa i{background:linear-gradient(#e8f6ff 50%,#1d9bf0 50%)}.ci .pl4.pb i{background:linear-gradient(#fff 50%,#ff4d6d 50%)}
.ci .vs{position:absolute;left:58%;top:40%;font-size:7.8em;color:#fff;-webkit-text-stroke:.064em #0b0f05;paint-order:stroke fill;text-shadow:.1em .1em 0 #0b0f05;transform:rotate(-4deg);animation:ciVs .45s 1.05s cubic-bezier(.2,1.6,.3,1) both;z-index:2}
.ci .tt{position:absolute;right:3%;top:3%;font-size:1.3em;color:#0b0f05}
@keyframes ciIn{from{opacity:0}to{opacity:1}}
@keyframes ciL{from{transform:translateX(-110%) rotate(-4deg)}to{transform:translateX(0) rotate(-4deg)}}
@keyframes ciR{from{transform:translateX(110%) rotate(-4deg)}to{transform:translateX(0) rotate(-4deg)}}
@keyframes ciPop{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes ciVs{from{transform:scale(3) rotate(-4deg);opacity:0}to{transform:scale(1) rotate(-4deg);opacity:1}}
/* tarjetas 1V1/2V2/3V3 con dibujo */
.sq-card{padding:.5em .5em .7em;gap:.5em}
.sq-card canvas.cvc{width:100%;height:auto;image-rendering:pixelated;display:block;box-shadow:0 0 0 .1em #000}
.sq-card .tag{font-size:.42em;color:#e8e8e8;letter-spacing:.1em}
/* en las batallas (entrada y resultados) la foto va CUADRADA y entera, como en X; redonda solo en perfil y listas */
.ci .sq-pic,.ci .sq-pic .av,.ci .sq-pic .av-cv,.ci .sq-pic img,#sqEnd .sq-pic,#sqEnd .sq-pic .av,#sqEnd .sq-pic .av-cv{border-radius:0}
/* ARENAS: tres tarjetas grandes con dibujo (pildoras azules contra rojas) y sin scroll */
.sq-cards{display:flex;gap:1em;width:100%}
.sq-card{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.7em;padding:1.1em .4em;background:rgba(0,0,0,.3);border:.14em solid #2f3d35;cursor:pointer}
.sq-card .big{font-size:1.3em;color:var(--ac,#00ff88);text-shadow:.1em .1em 0 #000}
.sq-card.dim{opacity:.45}
.sq-card:active{border-color:var(--ac,#00ff88)}
.sq-card{flex-direction:column}
.sq-menu{display:flex;flex-direction:column;gap:.7em;width:100%;align-items:center}
.sq-b.big{width:78%;font-size:1.05em;padding:.7em 1em}
.sq-chip{font-size:.4em;letter-spacing:.1em;padding:.4em .8em;border:.12em solid #2f3d35;color:#7d8a82}
.sq-chip.on{border-color:var(--ac,#00ff88);color:var(--ac,#00ff88)}
.sq-chip.off{opacity:.55}
.sq-rl{width:100%;display:flex;flex-direction:column;gap:.5em;flex:1;min-height:0;overflow-y:auto}
/* pantallas de arenas: cabecera arriba (BACK + modo), filtros debajo y el contenido ocupando el resto */
.sq-empty{margin:auto;text-align:center;line-height:1.8}
.sq-fixed .sq-menu{flex:1;justify-content:center}
.sq-b.blink{animation:sqBlink .7s steps(2) infinite;border-color:#ffd23a;color:#ffd23a}
@keyframes sqBlink{50%{background:#ffd23a;color:#04150c}}
#sqGuard{position:absolute;inset:0;z-index:420;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7);pointer-events:auto;font-family:'Press Start 2P',monospace;color:#fff}
#sqGuard.show{display:flex}
#sqGuard .bx{background:#0a110d;border:3px solid #ffb347;padding:16px 18px;max-width:78%;text-align:center;display:flex;flex-direction:column;gap:14px;font-size:9px;line-height:1.7}
#sqGuard .bx .r{display:flex;gap:10px;justify-content:center}
.sq-av .k{font-size:.4em;color:#e5302f;cursor:pointer;padding:.2em .6em;border:.14em solid #5a2420}
/* lista de salas */
.sq-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:1em;width:100%}
.sq-col{display:flex;flex-direction:column;gap:.5em;min-width:0}
.sq-ch{font-size:.62em;letter-spacing:.1em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000}
.sq-col.dim .sq-ch{color:#56635b}
.sq-rm{display:flex;align-items:center;gap:.7em;min-height:2.9em;padding:.4em .7em;background:rgba(0,0,0,.3);border:.07em solid rgba(255,255,255,.1);text-align:left;min-width:0}
.sq-rm .w{flex:1;min-width:0;display:flex;flex-direction:column;gap:.5em}
.sq-rm .sq-pic{width:1.9em;height:1.9em}
.sq-rm .n{font-size:.45em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-rm .s{font-size:.32em;color:#7d8a82;letter-spacing:.08em}
.sq-rm.empty{border:.12em dashed #2f3d35;background:none;justify-content:center;flex-direction:column;gap:.35em;cursor:pointer;text-align:center}
.sq-rm.empty .n{color:#5d6b63}
.sq-rm.empty .s{letter-spacing:.3em;color:#3d4a43}
.sq-rm.empty:active{border-color:var(--ac,#00ff88)}
.sq-col.dim .sq-rm{opacity:.5}
.sq-more{max-height:10.5em;overflow:auto;display:flex;flex-direction:column;gap:.5em}
/* amigos */
.sq-list{width:100%;max-height:9em;overflow:auto;display:flex;flex-direction:column;gap:.6em;text-align:left;padding-right:.2em}
.sq-it{display:flex;align-items:center;gap:.9em;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.08);padding:.6em .8em}
.sq-it .w{flex:1;min-width:0;display:flex;flex-direction:column;gap:.55em}
.sq-it .n{font-size:.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-it .s{font-size:.34em;letter-spacing:.08em;color:#7d8a82;display:flex;align-items:center;gap:.6em}
.sq-it .s i{width:.9em;height:.9em;background:#56635b;display:inline-block}
.sq-it .s.on i{background:#00ff66}.sq-it .s.party i{background:#4d9bff}.sq-it .s.game i{background:#ffd23a}
.sq-it .a{display:flex;gap:.5em;flex:none}
.sq-h{font-size:.4em;color:var(--ac,#00ff88);letter-spacing:.14em;text-align:left;width:100%}
.sq-bd{background:#e5302f;color:#fff;font-family:'Press Start 2P',monospace;font-size:.7em;padding:.3em .45em .2em;box-shadow:0 0 0 .15em #000;margin-left:.5em}
.sq-chat{width:100%;height:7.5em;overflow:auto;background:rgba(0,0,0,.35);border:.07em solid rgba(255,255,255,.08);padding:.6em .8em;display:flex;flex-direction:column;gap:.5em;text-align:left}
.sq-chat div{font-family:'VT323',monospace;font-size:1.05em;line-height:1.15;color:#cfd8d3;word-break:break-word}
.sq-chat div b{color:var(--ac,#00ff88);font-weight:400}
.sq-chat div.me b{color:#ffd23a}
.sq-pcp{position:fixed;inset:0;z-index:120;background:rgba(3,6,4,.88);display:none;align-items:center;justify-content:center}
.sq-pcp.open{display:flex}
.sq-pcp .sq-box{position:relative;width:min(48em,94vw);max-height:94vh;overflow:auto;font-size:16px;padding:1.6em 1.4em 1.2em;background:#0b120e;border:.2em solid var(--ac,#00ff88);box-shadow:0 0 0 .2em #000,.4em .4em 0 .2em rgba(0,0,0,.6),0 0 2em rgba(0,255,136,.25)}
.sq-pcp .sq-x{position:absolute;right:.5em;top:.4em;font-family:'Russo One',sans-serif;font-size:.7em;letter-spacing:.1em;padding:.4em .8em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer}
#sqFound{position:absolute;inset:0;z-index:300;pointer-events:auto;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(3,6,4,.82);font-family:'Press Start 2P',monospace;color:#fff;text-align:center}
#sqFound.show{display:flex}
#sqFound .a{font-size:22px;color:#ffd23a;text-shadow:3px 3px 0 #000,0 0 18px #ffd23a}
.lu{display:flex;align-items:center;gap:26px;margin:4px 0}
.lu .side{display:flex;gap:16px}
.lu .p{display:flex;flex-direction:column;align-items:center;gap:7px;width:84px}
.lu .p .sq-pic{width:58px;height:58px;font-size:22px}
.lu .p .nm{font-size:8px;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:1px 1px 0 #000}
.lu .side.me .nm{color:#3fa0ff}.lu .side.foe .nm{color:#ff6a5a}
.lu .vs{font-size:20px;color:#ffd23a;text-shadow:3px 3px 0 #000}
#sqFound .b{font-size:12px;color:#9bbfff}
/* barras de companeros a la izquierda, como el grupo del WoW: foto, nombre y barra de masa (contra su maximo) */
#sqHud{position:absolute;left:8px;top:64px;z-index:56;display:none;width:118px;font-family:'Press Start 2P',monospace;font-size:7px;line-height:1.4;pointer-events:none;text-shadow:1px 1px 0 #000}
#sqHud.show{display:block}
#sqHud .h{color:#8aa096;margin-bottom:4px;font-size:6px}
#sqHud .pf{display:flex;align-items:center;gap:5px;background:rgba(6,10,8,.6);border-left:3px solid #3fa0ff;padding:3px 5px;margin-bottom:4px}
#sqHud .pf .sq-pic{width:20px;height:20px;font-size:8px}
#sqHud .pf .w{flex:1;min-width:0}
#sqHud .pf .n{color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
#sqHud .pf .bar{height:7px;background:#1a2620;box-shadow:0 0 0 1px #000}
#sqHud .pf .bar i{display:block;height:100%;width:100%;background:#3fa0ff;transition:width .25s}
#sqHud .pf.dead{border-left-color:#555}#sqHud .pf.dead .n{color:#777;text-decoration:line-through}#sqHud .pf.dead .bar i{width:0!important}
#sqToast{position:absolute;left:26px;bottom:22px;z-index:310;display:flex;flex-direction:column;gap:8px;max-width:min(330px,92vw);font-family:'Press Start 2P',monospace}
#sqRc{position:absolute;inset:0;z-index:305;pointer-events:auto;display:none;align-items:center;justify-content:center;background:rgba(3,6,4,.7)}
#sqRc.show{display:flex}
#sqRc .bx{font-family:'Press Start 2P',monospace;color:#fff;text-align:center;background:rgba(8,12,10,.97);border:3px solid #ffd23a;box-shadow:0 0 18px rgba(255,210,58,.4),4px 4px 0 rgba(0,0,0,.6);padding:18px 24px;display:flex;flex-direction:column;gap:14px;align-items:center;max-width:90%}
#sqRc .a{font-size:13px;color:#ffd23a;text-shadow:2px 2px 0 #000}
#sqRc .b{font-size:9px;line-height:1.8;color:#cfd8d3}
#sqRc .r{display:flex;gap:12px}
#sqRc button{font-family:'Russo One',sans-serif;font-size:14px;letter-spacing:2px;padding:9px 22px;border:3px solid #000;background:#2c3630;color:#cfd8d3;cursor:pointer}
#sqRc button.y{background:#00ff88;color:#04150c}
#sqRc.pulse .bx{animation:sqPulse .5s steps(2) 3}
@keyframes sqPulse{50%{box-shadow:0 0 28px rgba(255,210,58,.9),4px 4px 0 rgba(0,0,0,.6)}}
#sqToast .t{pointer-events:auto;background:rgba(8,12,10,.96);border:2px solid #4d9bff;box-shadow:3px 3px 0 rgba(0,0,0,.6),0 0 14px rgba(77,155,255,.35);padding:9px 10px;font-size:8px;line-height:1.7;color:#fff;display:flex;flex-direction:column;gap:7px}
#sqToast .t.w{border-color:#ffd23a;box-shadow:3px 3px 0 rgba(0,0,0,.6),0 0 14px rgba(255,210,58,.3)}
#sqToast .t .r{display:flex;gap:6px;align-items:center}
#sqToast .t img{width:22px;height:22px;border-radius:50%;object-fit:cover}
#sqToast .t button{font-family:'Russo One',sans-serif;font-size:10px;letter-spacing:1px;padding:4px 10px;border:2px solid #2c3630;background:none;color:#9fb0a6;cursor:pointer}
#sqToast .t button.y{background:#00ff88;border-color:#00ff88;color:#04150c}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    // ---------------- identidad (cuenta del airdrop: wallet o X) ----------------
    async function loadIdentity(force) {
        if (!force && Date.now() - S.idAt < 10 * 60 * 1000 && S.x !== 'unknown') return;
        try {
            const j = await (await fetch('/api/airdrop/social-token', { cache: 'no-store' })).json();
            if (j && j.linked) { S.x = 'linked'; S.token = j.token; S.prof = j.me; }
            else { S.x = 'nosession'; S.token = null; S.prof = null; }
            S.idAt = Date.now();
        } catch (e) { /* sin red: se reintenta al abrir */ }
    }

    // ---------------- conexion ----------------
    async function hostUrl() {
        const qs = new URLSearchParams(location.search).get('server');
        let saved = null; try { saved = localStorage.getItem('pw_server'); } catch (e) {}
        const url = qs || saved || (location.protocol === 'https:' ? 'wss://' + location.host : 'ws://localhost:8080');
        try {
            const u = new URL(url), isWss = url.startsWith('wss://');
            const mj = await (await fetch((isWss ? 'https://' : 'http://') + u.host + '/match?mode=squad&price=Free', { cache: 'no-store' })).json();
            if (mj && mj.ok) {
                if (isWss && mj.path) return 'wss://' + u.host + mj.path + '/';
                if (!isWss && mj.port && String(mj.port) !== (u.port || '80')) return 'ws://' + u.hostname + ':' + mj.port;
            }
        } catch (e) {}
        return url;
    }
    function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(Object.assign({ t: 'sq' }, o))); }
    function myName() {
        const el = document.getElementById('playerNameInput');
        let n = (el && el.value || '').trim();
        if (!n) { try { n = localStorage.getItem('pw_app_name') || localStorage.getItem('pw_sq_name') || ''; } catch (e) {} }
        return (n || 'PLAYER').slice(0, 16);
    }
    // El icono del menu del jugador: lo ven sus amigos cuando no tiene foto de X.
    function myAv() { try { return window._hubAvatar ? window._hubAvatar() : null; } catch (e) { return null; } }
    function refreshAv() { if (S.token) send({ a: 'hello', token: S.token, av: myAv(), name: myName() }); }
    function connect(then) {
        if (S.ws && S.ws.readyState === 1) { then && then(); return; }
        if (then) S.after = then;   // si ya se esta conectando, se ejecuta al abrir
        if (S.conn === 'connecting') return;
        S.conn = 'connecting'; S.err = ''; render();
        loadIdentity().then(hostUrl).then(url => {
            const ws = new WebSocket(url);
            S.ws = ws;
            ws.onopen = () => {
                S.conn = 'open'; S.retry = 0;
                if (S.token) send({ a: 'hello', token: S.token, av: myAv(), name: myName() });   // antes que cualquier otra orden
                render(); const f = S.after; S.after = null; f && f();
            };
            ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
            ws.onclose = () => {
                if (S.ws !== ws) return;
                S.ws = null; S.conn = 'idle';
                if (S.party) { S.party = null; S.err = 'Connection lost.'; }
                render();
                // Si hay cuenta, se reconecta sola (el movil corta los sockets al dormir) para no perder amigos ni invitaciones.
                if (S.token) { S.retry = (S.retry || 0) + 1; setTimeout(() => { if (!S.ws && S.conn === 'idle') connect(() => send({ a: 'friends' })); }, Math.min(30000, 1500 * Math.pow(2, S.retry - 1))); }
            };
            ws.onerror = () => { if (S.conn === 'connecting') { S.conn = 'idle'; S.after = null; S.err = "Couldn't reach the server. Try again."; render(); } };
        });
    }
    setInterval(() => { if (S.ws && S.ws.readyState === 1) S.ws.send('{"t":"ping","ts":' + Date.now() + '}'); }, 25000);
    function badgeCount() { return S.friends.inReq.length + Object.values(S.unread).reduce((a, b) => a + b, 0); }
    function onMsg(m) {
        if (m.t === 'sqParty') { if (m.members.length >= 2 && !(S.party && S.party.members.length >= 2)) S.frTab = 'group'; S.party = m; S.me = m.me; S.err = ''; if (!m.rc) hideRc(); rivalsBanner(); render(); }
        else if (m.t === 'sqGone') { S.party = null; S.err = m.reason === 'kicked' ? 'You were removed from the group.' : ''; render(); }
        else if (m.t === 'sqErr') { if (m.reason === 'slow_down') return; S.err = ERRS[m.reason] || 'Something went wrong.'; S.note = ''; render(); }   // pulsar dos veces no es un error que haya que contar
        else if (m.t === 'sqTicket') onTicket(m);
        else if (m.t === 'sqMe') { S.prof = m.me; }
        else if (m.t === 'sqFriends') { S.friends = { friends: m.friends, inReq: m.inReq, outReq: m.outReq }; S.note = ''; render(); }
        else if (m.t === 'sqPresence') { const f = S.friends.friends.find(x => x.id === m.id); if (f) { f.st = m.st; render(); } }
        else if (m.t === 'sqRooms') { S.rooms = m.rooms; render(); }
        else if (m.t === 'sqInvited') { S.note = 'Invite sent!'; S.err = ''; render(); }
        else if (m.t === 'sqFriendReq') { toast({ pic: m.from.p, text: esc(nameOf(m.from)) + ' wants to be your friend', warm: true, actions: [['ACCEPT', () => send({ a: 'faccept', id: m.from.id }), 1], ['LATER', null]] }); render(); }
        else if (m.t === 'sqInvite') onInvite(m);
        else if (m.t === 'sqReadyCheck') onReadyCheck(m);
        else if (m.t === 'sqReadyEnd') { hideRc(); toast({ text: esc(m.why || 'Search cancelled'), warm: true, ms: 6000 }); }
        else if (m.t === 'sqWhisper') onWhisper(m);
    }

    // ---------------- avisos ----------------
    // Marco girado (ver CSS): ahi viven los carteles que no cuelgan del hub.
    function frame() {
        let f = document.getElementById('sqFrame');
        if (!f) { f = document.createElement('div'); f.id = 'sqFrame'; document.body.appendChild(f); }
        return f;
    }
    function toast(o) {
        let box = document.getElementById('sqToast');
        if (!box) { box = document.createElement('div'); box.id = 'sqToast'; frame().appendChild(box); }
        const el = document.createElement('div'); el.className = 't' + (o.warm ? ' w' : '');
        el.innerHTML = '<div class="r">' + (o.pic ? '<img src="' + esc(o.pic) + '" alt="" referrerpolicy="no-referrer">' : '') + '<div>' + o.text + '</div></div>' + (o.actions ? '<div class="r">' + o.actions.map((a, i) => '<button data-i="' + i + '" class="' + (a[2] ? 'y' : '') + '">' + a[0] + '</button>').join('') + '</div>' : '');
        const kill = () => { clearTimeout(tm); el.remove(); };
        const tm = setTimeout(kill, o.ms || 14000);
        el.querySelectorAll('button').forEach(b => b.onclick = () => { const a = o.actions[+b.dataset.i]; kill(); if (a[1]) a[1](); });
        el.querySelectorAll('img').forEach(im => { im.onerror = () => im.remove(); });
        box.appendChild(el); snd('alert');
        while (box.children.length > 3) box.firstChild.remove();
    }
    // TRY AGAIN tras morir en la practica: se pide otra entrada a la misma sala si el grupo sigue buscando.
    function practiceAgain() {
        if (S.party && S.party.state === 'queued' && S.ws && S.ws.readyState === 1) { window._sqAgain = true; send({ a: 'practice' }); return true; }
        return false;
    }
    // Cartel de LISTO para los companeros: el lider ha pulsado buscar o unirse y hay que confirmar.
    const RC_TXT = { quick: 'QUICK MATCH', room: 'NEW ROOM', join: 'JOINING A ROOM' };
    function hideRc() { const el = document.getElementById('sqRc'); if (el) el.classList.remove('show'); clearInterval(S.rcTimer); }
    function onReadyCheck(m) {
        let el = document.getElementById('sqRc');
        if (!el) { el = document.createElement('div'); el.id = 'sqRc'; el.innerHTML = '<div class="bx"><div class="a"></div><div class="b"></div><div class="r"><button class="y" data-v="1">READY</button><button data-v="0">NOT READY</button></div></div>'; frame().appendChild(el); }
        el.querySelector('.a').textContent = String(m.leader).toUpperCase() + ' WANTS TO START';
        const paint = () => { const s = Math.max(0, Math.round((m.exp - Date.now()) / 1000)); el.querySelector('.b').innerHTML = RC_TXT[m.kind] + ' · ' + m.size + 'V' + m.size + '<br>' + s + 's'; if (s <= 0) hideRc(); };
        paint(); clearInterval(S.rcTimer); S.rcTimer = setInterval(paint, 500);
        el.querySelectorAll('button').forEach(b => b.onclick = () => { send({ a: 'ready', v: b.dataset.v === '1' }); hideRc(); });
        el.classList.add('show'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
        snd('alert');
    }
    function onInvite(m) {
        toast({
            pic: m.from.p, warm: true, ms: 30000, text: esc(nameOf(m.from)) + ' invites you to a group',
            actions: [['JOIN', () => joinCode(m.code), 1], ['NO', null]],
        });
    }
    function joinCode(code) {
        if (S.party) { send({ a: 'leave' }); S.party = null; }
        openFriends();
        connect(() => send({ a: 'join', code, name: myName() }));
    }
    function onWhisper(m) {
        const other = m.mine ? m.to : m.from;
        const list = S.chat[other.id] || (S.chat[other.id] = []);
        list.push({ me: !!m.mine, text: m.text, ts: m.ts }); if (list.length > 40) list.shift();
        if (!m.mine) {
            const viewing = S.chatWith === other.id && isOpen('friends');
            if (!viewing) {
                S.unread[other.id] = (S.unread[other.id] || 0) + 1;
                toast({ pic: other.p, text: esc(friendName(other)) + ': ' + esc(m.text.slice(0, 80)), actions: [['REPLY', () => { S.chatWith = other.id; S.unread[other.id] = 0; openFriends(); }, 1], ['X', null]], ms: 9000 });
            }
        }
        render();
        const c = S.box.friends && S.box.friends.querySelector('.sq-chat'); if (c) c.scrollTop = c.scrollHeight;
    }

    // ---------------- entrada a sala ----------------
    function enter(ticket, kind, mode) {
        if (S.enterBusy) return;
        S.enterBusy = true; setTimeout(() => { S.enterBusy = false; }, 2500);
        closeAll();
        if (typeof window.pwSquadEnter === 'function') window.pwSquadEnter(ticket, kind, mode);
    }
    function onTicket(m) {
        // REJOIN: vuelves a TU partida (ya habias muerto): se entra directo a mirar con tu equipo, sin VS.
        if (m.rejoin) { S.lineupData = null; enter(m.ticket, 'rejoin', m.mode); return; }
        if (m.kind === 'practice') {
            S.lineup = null; S.lineupData = null;
            // El jugador pidio practicar mientras espera. Si ya hay una partida de equipo en curso no se pisa.
            if (window.pwSquadActive && window.pwSquadActive() === 'match') return;
            enter(m.ticket, 'practice', m.mode);
            return;
        }
        // Rival encontrado: aviso con cuenta atras y entrada automatica.
        let n = 5;
        const el = foundEl();
        const paint = () => { el.querySelector('.b').textContent = 'ENTERING IN ' + n + '…'; };
        el.querySelector('.a').textContent = 'RIVAL FOUND!';
        // Fotos de tu equipo VS fotos del rival, con su nombre de X o de wallet: asi sabes con quien juegas.
        const side = (list, cls) => '<div class="side ' + cls + '">' + (list || []).map(x => '<div class="p">' + pic({ p: x.pic, av: x.av, n: x.name }) + '<span class="nm">' + esc(x.name) + '</span></div>').join('') + '</div>';
        const mine = m.team === 'B' ? 'B' : 'A', other = mine === 'A' ? 'B' : 'A';
        S.lineupData = m.lineup ? { me: m.lineup[mine], foe: m.lineup[other] } : null; S.lastSize = m.size;
        S.lineup = m.lineup ? '<div class="lu">' + side(m.lineup[mine], 'me') + '<span class="vs">VS</span>' + side(m.lineup[other], 'foe') + '</div>' : null;
        el.querySelector('.c').innerHTML = m.lineup
            ? '<div class="lu">' + side(m.lineup[mine], 'me') + '<span class="vs">VS</span>' + side(m.lineup[other], 'foe') + '</div>'
            : esc(m.size + 'V' + m.size + ' · TEAM ' + m.team);
        hydrate(el);
        el.classList.add('show'); paint(); snd('alert');
        clearInterval(S.ticketTimer);
        S.ticketTimer = setInterval(() => {
            n--;
            if (n > 0) { paint(); return; }
            clearInterval(S.ticketTimer); S.ticketTimer = null;
            el.classList.remove('show');
            S.enterBusy = false;
            enter(m.ticket, 'match', m.mode);
        }, 1000);
    }
    function foundEl() {
        let el = document.getElementById('sqFound');
        if (!el) { el = document.createElement('div'); el.id = 'sqFound'; el.innerHTML = '<div class="a"></div><div class="c b"></div><div class="b"></div>'; frame().appendChild(el); }
        return el;
    }

    // ---------------- dentro de la partida ----------------
    function hud() {
        let el = document.getElementById('sqHud');
        if (!el) { el = document.createElement('div'); el.id = 'sqHud'; frame().appendChild(el); }
        return el;
    }
    // Posiciones de companeros que manda el servidor (4 por segundo): el juego las marca en el borde si no se ven.
    // En la practica, mientras el grupo busca rival, sale el cartel azul de FINDING ROOM pero con RIVALS (y nada mas).
    let rivT = null, rivN = 0;
    function rivalsBanner() {
        const on = !!(S.party && S.party.state === 'queued' && S.roster && S.roster.practice && S.rel);
        if (on && !rivT) {
            rivN = 0;
            const put = () => { if (typeof window.setLobbyBanner === 'function') window.setLobbyBanner('FINDING RIVALS' + '.'.repeat((rivN++ % 3) + 1), 'search'); };
            put(); rivT = setInterval(put, 400);
        } else if (!on && rivT) { clearInterval(rivT); rivT = null; if (typeof window.setLobbyBanner === 'function') window.setLobbyBanner(null); }
    }
    function onAllies(m) {
        S.allies = { t: Date.now(), a: m.a || [], tg: m.tg || null };
        const el = document.getElementById('sqHud');
        for (const f of m.f || []) {
            const row = el && el.querySelector('.pf[data-id="' + f.id + '"]'); if (!row) continue;
            row._pk = Math.max(row._pk || 0, f.m);
            row.classList.toggle('dead', !f.m);
            row.querySelector('.bar i').style.width = (row._pk ? Math.round(100 * f.m / row._pk) : 100) + '%';
        }
    }
    function onRoster(m) {
        S.roster = m; S.allies = null; setTimeout(rivalsBanner, 0);
        S.rel = new Map();
        const mine = m.me === 'A' ? 'A' : 'B', other = mine === 'A' ? 'B' : 'A';
        for (const p of m.teams[mine]) S.rel.set(p.id, 'ally');
        for (const p of m.teams[other]) S.rel.set(p.id, 'foe');
        const el = hud(), me = m.myId;
        const mates = m.teams[mine].filter(p => p.id !== me);
        el.innerHTML = (m.practice && mates.length ? '<div class="h">PRACTICE</div>' : '') + mates.map(p =>
            '<div class="pf" data-id="' + esc(p.id) + '">' + pic({ p: p.pic, av: p.av, n: p.name }) + '<div class="w"><div class="n">' + esc(p.name || 'PLAYER') + '</div><div class="bar"><i></i></div></div></div>').join('');
        hydrate(el);
        el.classList.toggle('show', mates.length > 0);   // en 1v1 no hay companeros: nada a la izquierda
    }
    // Tamano base en pixeles ENTEROS y pares: con decimales la letra pixel se veia borrosa (sobre todo en PC).
    function nitido(el) {
        const M = Math.max(innerWidth, innerHeight), m = Math.min(innerWidth, innerHeight);
        el.style.fontSize = Math.max(10, 2 * Math.round(Math.min(M * 0.0125, m * 0.027) / 2)) + 'px';
    }
    addEventListener('resize', () => document.querySelectorAll('#sqEnd,.ci').forEach(nitido));
    // Pildoras de fondo como en el diseno: confeti de colores arriba en la victoria, grises "comidas" abajo en la derrota,
    // unas pocas amarillas en el empate. Con los sprites del juego y siempre en diagonal.
    function fondoFin(el, tipo) {
        const cv = el.querySelector('canvas.fx'), spr = window.pwPillSprite; if (!cv || !spr) return;
        const W = cv.width = Math.round(el.clientWidth / 2), H = cv.height = Math.round(el.clientHeight / 2);
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H);
        const COL = ['#ff4d6d', '#1d9bf0', '#ffce3d', '#b86bff', '#00ff88', '#ff8a3d', '#ccff00', '#ff5fd2'];
        let sd = 9; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
        const n = tipo === 'win' ? 18 : 10;
        for (let i = 0; i < n; i++) {
            const top = tipo === 'win' ? '#ffffff' : tipo === 'draw' ? '#fff3c4' : '#5a5a5a';
            const bot = tipo === 'win' ? COL[i % COL.length] : tipo === 'draw' ? '#ffd23a' : '#2a2a2a';
            const o = spr(6, top, bot, -Math.PI / 4, true), c = o.cv || o;
            // a los lados del titulo, sin taparlo
            const lado = rnd() < .5 ? rnd() * .22 : .78 + rnd() * .22;
            const x = 8 + lado * (W - 16), y = 6 + rnd() * H * 0.2;   // abajo quedaban tapadas por la banda
            g.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
        }
    }
    function onEnd(m) {
        hud().classList.remove('show');
        S.rel = null; S.allies = null; rivalsBanner();
        if (m.practice) {
            // La practica acabo: si el grupo sigue buscando, se vuelve a ofrecer sin meter a nadie a la fuerza.
            return;
        }
        // Pantalla de fin (diseno C): banda oscura en diagonal, VICTORY en verde o DEFEAT en rojo, filas con foto, kills y peak.
        let el = document.getElementById('sqEnd');
        if (!el) {
            el = document.createElement('div'); el.id = 'sqEnd';
            el.innerHTML = '<canvas class="fx"></canvas><div class="band"><div class="t"></div><div class="cols"><div class="tms"></div><div class="prz"></div></div></div><div class="bts"><button data-e="again">PLAY AGAIN</button><button data-e="menu" class="o">MENU</button></div>';
            frame().appendChild(el);
            el.querySelector('[data-e="menu"]').onclick = () => { el.classList.remove('show'); try { returnToMenu(); } catch (e) {} };
            // PLAY AGAIN: vuelta a la pantalla del grupo; hay que dar LISTO otra vez.
            el.querySelector('[data-e="again"]').onclick = () => {
                el.classList.remove('show');
                try { returnToMenu(); } catch (e) {}
                setTimeout(() => { S.arStep = S.lastSize ? { size: S.lastSize, view: null } : null; const b = document.querySelector('#appHub [data-a="arenas"]'); if (b) b.click(); else openPc('rooms'); S.arStep = S.lastSize ? { size: S.lastSize, view: null } : null; render(); }, 250);
            };
        }
        const mine = S.roster ? S.roster.me : 'A', other = mine === 'A' ? 'B' : 'A', win = m.winner === mine;
        const n3 = Math.max(((m.players || {}).A || []).length, ((m.players || {}).B || []).length) >= 3;
        el.className = (!m.winner ? 'draw' : win ? 'win' : 'lose') + (n3 ? ' n3' : '');   // n3: 3v3, filas mas bajas para que quepan
        el.querySelector('.t').textContent = !m.winner ? 'DRAW' : win ? 'VICTORY!' : 'DEFEAT';
        const row = (p, cls) => '<div class="rw' + (p.alive ? '' : ' dead') + '"><span class="ph ' + cls + '">' + pic({ p: p.pic, av: p.av, n: p.name }) + '</span><span class="nm">' + esc(p.name) + '</span>' +
            '<span class="k">' + p.kills + ' KILL' + (p.kills === 1 ? '' : 'S') + '</span><span class="pk' + (p.byBot ? ' bot' : '') + '">' + p.peak.toLocaleString('en-US') + ' PEAK</span></div>';   // comido por un bot: tachado en rojo
        const list = (t, cls) => ((m.players && m.players[t]) || []).map(p => row(p, cls)).join('');
        el.querySelector('.tms').innerHTML = '<div><div class="h me">YOUR TEAM</div>' + list(mine, 'me') + '</div><div><div class="h foe">RIVALS</div>' + list(other, 'foe') + '</div>';
        // Arenas gratis: se recuerda que en las salas de pago se gana $PILLY (con $PILLY en juego ira la cantidad y CLAIM).
        el.querySelector('.prz').innerHTML = '<div class="pt">FREE MATCH</div><div class="pd">Next time play a <b>paid room</b><br>and ' + (win ? 'take' : 'win') + ' their <b>$PILLY</b>.</div>';
        hydrate(el);
        nitido(el); el.classList.add('show'); fondoFin(el, !m.winner ? 'draw' : win ? 'win' : 'lose'); snd(win ? 'select' : 'alert');
    }
    // Pantalla de entrada a la partida (diseno C, animada ~4 s): fondo lima, entra la banda azul con tu equipo,
    // golpe del VS y entra la banda roja con los rivales. index.html la mete en #sqEntry.
    function intro() {
        const d = S.lineupData; if (!d) return null;
        const tiles = (list, cls) => list.map((x, i) => '<div class="ti ' + cls + '" style="animation-delay:' + (cls === 'me' ? .45 + i * .15 : 1.75 + i * .15) + 's">' + pic({ p: x.pic, av: x.av, n: x.name }) + '<span class="nm">' + esc(x.name) + '</span></div>').join('');
        const pills = cls => '<div class="pl4 ' + cls + '">' + '<i></i>'.repeat(4) + '</div>';
        const el = document.createElement('div'); el.className = 'ci'; nitido(el);
        el.innerHTML = '<div class="bd ba"><div class="row">' + tiles(d.me, 'me') + '</div>' + pills('pa') + '</div>' +
            '<div class="vs">VS</div>' +
            '<div class="bd bb"><div class="row">' + tiles(d.foe, 'foe') + '</div>' + pills('pb') + '</div>' +
            '<div class="tt">ARENAS · ' + d.me.length + 'V' + d.me.length + '</div>';
        hydrate(el);
        return el;
    }
    // Dibujo de cada tarjeta 1V1/2V2/3V3: un trozo de mapa (cuadricula y comida) con las pildoras del juego enfrentadas.
    function drawCards(box) {
        const spr = window.pwPillSprite; if (!box || !spr) return;
        box.querySelectorAll('canvas.cvc').forEach(cv => {
            const n = +cv.dataset.n, W = cv.width = 220, H = cv.height = 150, g = cv.getContext('2d');
            g.imageSmoothingEnabled = false;
            g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
            g.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 0; x < W; x += 20) g.fillRect(x, 0, 1, H); for (let y = 0; y < H; y += 20) g.fillRect(0, y, W, 1);
            const FOOD = ['#ff4d6d', '#1d9bf0', '#ffce3d', '#b86bff', '#00ff88', '#ff8a3d', '#ccff00', '#2ee6d6'];
            let sd = 11 + n * 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
            for (let i = 0; i < 22; i++) { g.fillStyle = FOOD[i % FOOD.length]; g.fillRect(Math.round(rnd() * W), Math.round(rnd() * H), 3, 3); }
            const tint = g.createLinearGradient(0, 0, W, 0); tint.addColorStop(0, 'rgba(29,155,240,.32)'); tint.addColorStop(.5, 'rgba(0,0,0,0)'); tint.addColorStop(1, 'rgba(255,77,109,.32)');
            g.fillStyle = tint; g.fillRect(0, 0, W, H);
            const sz = n === 1 ? 16 : n === 2 ? 11 : 8, k = 3;
            const pos = n === 1 ? [[58, 75]] : n === 2 ? [[44, 46], [70, 104]] : [[34, 32], [70, 75], [34, 118]];
            const put = (o, x, y) => { const c = o.cv || o; g.drawImage(c, Math.round(x - c.width * k / 2), Math.round(y - c.height * k / 2), c.width * k, c.height * k); };
            pos.forEach(([x, y]) => { put(spr(sz, '#e8f6ff', '#1d9bf0', Math.PI / 4, true), x, y); put(spr(sz, '#ffffff', '#ff4d6d', -Math.PI / 4, true), W - x, y); });
        });
    }

    // ---------------- UI ----------------
    // Foto de X; sin ella, el icono del menu del jugador (se dibuja al pintar, ver hydrate); y si no, su inicial.
    const FALLBACK_AV = { t: 'spook', bg: '#ab9ff2' };
    const pic = o => o.p ? '<img class="sq-pic" src="' + esc(o.p) + '" alt="" referrerpolicy="no-referrer" data-fb="' + esc(JSON.stringify(o.av || FALLBACK_AV)) + '">'
        : (o.av && window._hubAvatarEl ? '<span class="sq-pic" data-av="' + esc(JSON.stringify(o.av)) + '"></span>' : '<span class="sq-pic">' + initial(o) + '</span>');
    const memberO = m => ({ p: m.pic, av: m.av, u: '', n: m.name });
    function hydrate(box) {
        // Si la foto de X no carga, se usa el icono que el jugador eligio en su perfil.
        box.querySelectorAll('img[data-fb]').forEach(im => {
            const fb = () => {
                if (!im.isConnected || !window._hubAvatarEl) return;
                try { const sp = document.createElement('span'); sp.className = 'sq-pic'; sp.appendChild(window._hubAvatarEl(JSON.parse(im.dataset.fb), 96)); im.replaceWith(sp); } catch (e) {}
            };
            if (im.complete && im.naturalWidth === 0) fb(); else im.onerror = fb;
        });
        box.querySelectorAll('[data-av]').forEach(x => {
            try { const el = window._hubAvatarEl(JSON.parse(x.dataset.av), 96); x.removeAttribute('data-av'); x.appendChild(el); } catch (e) { x.removeAttribute('data-av'); }
        });
    }
    const imLeader = () => !S.party || S.party.leader === S.me;
    const groupSize = () => S.party ? S.party.members.length : 1;
    const errLine = () => '<div class="sq-err">' + (S.note ? '<span class="sq-ok">' + esc(S.note) + '</span>' : esc(S.err || '')) + '</div>';

    // El grupo: foto de cada uno con el nombre debajo.
    function groupHtml(withKick, slots, big, small) {
        const p = S.party;
        if (!p) return '';
        const out = [];
        for (let i = 0; i < Math.max(slots || p.members.length, p.members.length); i++) {
            const m = p.members[i];
            if (!m) { out.push('<div class="sq-av empty"><span class="sq-pic">+</span><div class="n" style="color:#4a5850">EMPTY</div></div>'); continue; }
            const rcTag = p.rc ? (p.rc.ready[m.id] ? '<div class="l" style="color:#00ff66">READY</div>' : '<div class="l" style="color:#ffb347">WAITING…</div>') : '';
            out.push('<div class="sq-av' + (m.id === S.me ? ' me' : '') + '">' + pic(memberO(m)) + '<div class="n">' + esc(m.name) + '</div>' +
                (p.rc ? rcTag : (m.leader ? '<div class="l">LEADER</div>' : (withKick && S.party.leader === S.me && p.state === 'idle' ? '<span class="k" data-k="' + m.id + '">KICK</span>' : ''))) + '</div>');
        }
        return '<div class="sq-grp' + (big ? ' big' : '') + (small ? ' small' : '') + '">' + out.join('') + '</div>';
    }

    // ----- panel ARENAS: lista de salas / buscando -----
    function searchingHtml() {
        const p = S.party, leader = imLeader();
        const secs = Math.max(0, Math.round((Date.now() - (p.queuedAt || Date.now())) / 1000));
        return '<div class="sq find"><div class="mid"><div class="sq-q" id="sqQ">' + (p.custom ? 'ROOM OPEN · WAITING FOR A RIVAL' : 'SEARCHING FOR A RIVAL') + ' · ' + secs + 's</div>' +
            groupHtml(false, p.size, true) + '</div>' +
            '<div class="sq-bot"><div class="sq-row"><button class="sq-b on" data-a="practice">' + (p.practice ? 'JOIN PRACTICE' : 'PLAY WHILE YOU WAIT') + '</button>' +
            (leader ? '<button class="sq-b" data-a="cancel">CANCEL</button>' : '') + '</div>' + errLine() + '</div></div>';
    }
    // El lider ha pulsado buscar o unirse: se espera a que todos den LISTO.
    function readyCheckHtml() {
        const p = S.party, leader = imLeader(), mine = p.rc.ready[S.me];
        const s = Math.max(0, Math.round((p.rc.exp - Date.now()) / 1000));
        const falta = Object.values(p.rc.ready).filter(v => !v).length;
        return '<div class="sq find"><div class="mid"><div class="sq-q" id="sqRcQ">' + (leader ? 'WAITING FOR YOUR TEAM' : 'READY CHECK') + ' · ' + RC_TXT[p.rc.kind] + ' · ' + s + 's</div>' +
            groupHtml(false, p.size, true) + '</div>' +
            '<div class="sq-bot"><div class="sq-row">' +
            (leader ? '<button class="sq-b on" data-a="remind"' + (falta ? '' : ' disabled') + '>READY ALL</button><button class="sq-b" data-a="cancel">CANCEL</button>'
                : (mine ? '<span class="sq-q">READY · WAITING FOR THE OTHERS</span>' : '<button class="sq-b on" data-a="rok">READY</button><button class="sq-b" data-a="rno">NOT READY</button>')) +
            '</div>' + errLine() + '</div></div>';
    }
    // ----- panel ARENAS: modo (1V1/2V2/3V3) -> QUICK MATCH / CREATE ROOM / JOIN ROOM -----
    const arMode = () => 'arcade';   // arenas es un solo modo (con skills elegidas en THE PILL), se entre desde arcade o classic
    function roomCard(r) {
        return '<div class="sq-rm">' + pic({ p: r.leader.pic, av: r.leader.av, n: r.leader.name }) + '<div class="w"><div class="n">' + esc(r.leader.name) + '</div><div class="s">' + r.members.length + '/' + r.size + ' IN ROOM · FREE</div></div>' +
            '<button class="sq-b sm gold" data-join="' + esc(r.code) + '" data-size="' + r.size + '">JOIN</button></div>';
    }
    function modeTitle() { return 'ARENAS'; }
    function roomsHtml() {
        const p = S.party;
        if (p && p.rc) return readyCheckHtml();
        if (p && p.state === 'queued') return searchingHtml();
        if (p && p.state === 'match') return '<div class="sq find"><div class="mid"><div class="sq-q">MATCH IN PROGRESS</div>' + groupHtml(false, p.size, true) + '</div><div class="sq-bot"><div class="sq-row"><button class="sq-b on" data-a="rejoin">REJOIN</button></div>' + errLine() + '</div></div>';
        const mine = groupSize(), step = S.arStep;
        if (!step) {
            const cards = SIZES.map(n => '<div class="sq-card' + (n === mine ? '' : ' dim') + '" data-size="' + n + '"><canvas class="cvc" data-n="' + n + '"></canvas><div class="tag">' + ['DUEL', 'DUO', 'SQUAD'][n - 1] + '</div><div class="big">' + n + 'V' + n + '</div></div>').join('');
            const hint = mine > 1 ? 'YOUR GROUP · ' + mine + ' PLAYERS · ' + mine + 'V' + mine : 'PLAYING SOLO · FORM A GROUP IN FRIENDS FOR 2V2 / 3V3';
            return '<div class="sq"><div class="sq-row"><span class="sq-lab">' + hint + '</span></div><div class="sq-cards">' + cards + '</div>' + errLine() + '</div>';
        }
        const n = step.size, live = S.rooms.filter(r => r.size === n && (r.mode || 'arcade') === arMode());
        const head = '<div class="sq-row" style="justify-content:flex-start"><button class="sq-b sm" data-a="stepx">BACK</button><span class="sq-lab">' + n + 'V' + n + '</span></div>';
        if (step.view === 'join') {
            const list = live.map(roomCard).join('') || '<div class="sq-note sq-empty">No open ' + n + 'V' + n + ' rooms right now.<br>Create one!</div>';
            return '<div class="sq sq-fixed">' + head + '<div class="sq-row"><span class="sq-chip on">ALL</span><span class="sq-chip on">FREE</span><span class="sq-chip off">$ SOON</span></div><div class="sq-rl">' + list + '</div>' + errLine() + '</div>';
        }
        return '<div class="sq sq-fixed">' + head + '<div class="sq-menu">' +
            '<button class="sq-b on big" data-a="quick">QUICK MATCH · FREE</button>' +
            '<button class="sq-b big" data-a="create">CREATE ROOM</button>' +
            '<button class="sq-b big" data-a="joinv">JOIN ROOM' + (live.length ? ' · ' + live.length : '') + '</button></div>' +
            '<div class="sq-row"><span class="sq-chip off">QUICK MATCH $ · SOON</span></div>' + errLine() + '</div>';
    }

    // ----- panel AMIGOS: grupo, amigos y susurros -----
    function noAccount() {
        return '<div class="sq"><div class="sq-t">FRIENDS</div><div class="sq-p">' + (EN_APP
            ? 'Connect your wallet to get a friends list, invites and whispers. Your wallet is your account.'
            : 'Sign in with your wallet or your X account on the airdrop page to get a friends list, invites and whispers.') + '</div>' +
            '<div class="sq-row"><button class="sq-b on" data-a="login">' + (EN_APP ? 'CONNECT WALLET' : 'OPEN AIRDROP PAGE') + '</button><button class="sq-b" data-a="recheck">I DID IT</button></div></div>';
    }
    function friendsHtml() {
        if (S.x !== 'linked') return noAccount();
        const F = S.friends, p = S.party;
        const searching = !!(p && p.state === 'queued');
        const canInvite = !p || ((p.state === 'idle' || searching) && p.members.length < p.max && imLeader());
        if (S.chatWith) {
            const f = F.friends.find(x => x.id === S.chatWith) || { u: '?', p: '', st: 'off', id: S.chatWith };
            const msgs = (S.chat[f.id] || []).map(m => '<div class="' + (m.me ? 'me' : '') + '"><b>' + (m.me ? 'YOU' : esc(friendName(f))) + ':</b> ' + esc(m.text) + '</div>').join('') || '<div>Say hi to ' + esc(friendName(f)) + '.</div>';
            return '<div class="sq"><div class="sq-row" style="justify-content:flex-start"><button class="sq-b sm" data-a="chatx">BACK</button>' + pic(f) + '<span style="font-size:.5em">' + esc(friendName(f)) + '</span></div>' +
                '<div class="sq-chat" id="sqChat">' + msgs + '</div>' +
                '<div class="sq-row" style="flex-wrap:nowrap"><input class="sq-in" id="sqMsg" maxlength="200" placeholder="Whisper…" autocomplete="off"><button class="sq-b sm on" data-a="wsend">SEND</button></div>' + errLine() + '</div>';
        }
        // El grupo solo se enseña cuando de verdad hay alguien mas contigo.
        // Dos pantallas del mismo tamano: FRIENDS (lista) y GROUP (tu grupo). Asi el panel no crece al entrar alguien.
        const hayGrupo = !!(p && p.members.length >= 2);
        if (!hayGrupo) S.frTab = 'friends';
        const tabs = '<div class="sq-tabs"><button class="sq-tab' + (S.frTab !== 'group' ? ' on' : '') + '" data-tab="friends">FRIENDS</button>' +
            '<button class="sq-tab' + (S.frTab === 'group' ? ' on' : '') + '" data-tab="group"' + (hayGrupo ? '' : ' disabled') + '>GROUP' + (hayGrupo ? ' · ' + p.members.length + '/' + p.max : '') + '</button></div>';
        if (S.frTab === 'group' && hayGrupo) {
            return '<div class="sq sq-fixed">' + tabs + '<div class="sq-gw">' + groupHtml(true, p.members.length) + '</div>' +
                '<div class="sq-row"><button class="sq-b sm red" data-a="leave">LEAVE GROUP</button></div></div>';
        }
        const grp = '';
        const aviso = searching ? '<div class="sq-note" style="color:#ffb347">You are searching for a match. If a friend accepts your invite, the search is cancelled.</div>' : '';
        const reqs = F.inReq.length ? '<div class="sq-h">REQUESTS</div><div class="sq-list">' + F.inReq.map(r => '<div class="sq-it">' + pic(r) + '<div class="w"><div class="n">' + esc(nameOf(r)) + '</div></div><div class="a"><button class="sq-b sm on" data-ac="' + r.id + '">ACCEPT</button><button class="sq-b sm" data-dc="' + r.id + '">NO</button></div></div>').join('') + '</div>' : '';
        const order = { on: 0, party: 1, game: 1, off: 2 };
        const list = F.friends.slice().sort((a, b) => order[a.st] - order[b.st] || nameOf(a).localeCompare(nameOf(b))).map(f =>
            '<div class="sq-it">' + pic(f) + '<div class="w">' + (S.nickEdit === f.id
                ? '<input class="sq-in" id="sqNick" maxlength="16" placeholder="NICKNAME (ONLY YOU SEE IT)" value="' + esc(nicks[f.id] || '') + '" autocomplete="off">'
                : '<div class="n">' + esc(friendName(f)) + (S.unread[f.id] ? '<span class="sq-bd">' + S.unread[f.id] + '</span>' : '') + '</div>') +
            '<div class="s ' + f.st + '"><i></i>' + ST[f.st] + (nicks[f.id] ? ' · ' + esc(nameOf(f)) : '') + '</div></div>' +
            (S.nickEdit === f.id ? '<div class="a"><button class="sq-b sm on" data-nks="' + f.id + '">SAVE</button><button class="sq-b sm" data-nkc="1">X</button></div>' :
            '<div class="a">' + (canInvite && f.st !== 'off' && !(p && p.members.some(x => x.uid === f.id)) ? '<button class="sq-b sm on" data-inv="' + f.id + '"' + (searching ? ' data-warn="1"' : '') + '>INVITE</button>' : '') + '<button class="sq-b sm' + (S.unread[f.id] ? ' blink' : '') + '" data-w="' + f.id + '"' + (f.st === 'off' ? ' disabled' : '') + '>WHISPER</button><button class="sq-b sm" data-nk="' + f.id + '">NICK</button><button class="sq-b sm red" data-rm="' + f.id + '">X</button></div>') + '</div>').join('');
        return '<div class="sq sq-fixed">' + tabs + grp + aviso +
            '<div class="sq-row" style="flex-wrap:nowrap"><input class="sq-in" id="sqAdd" maxlength="48" placeholder="ADD: @X NAME, WALLET OR CODE" autocomplete="off"><button class="sq-b sm on" data-a="fadd">ADD</button></div>' +
            reqs + '<div class="sq-h">FRIENDS · ' + F.friends.filter(f => f.st !== 'off').length + ' ONLINE</div>' +
            '<div class="sq-list">' + (list || '<div class="sq-note" style="padding:.8em">No friends yet. Add someone by their @X name, wallet address or friend code (it is in your profile). They need to have opened Arenas or Friends once.</div>') + '</div>' +
            (F.outReq.length ? '<div class="sq-note">Pending: ' + F.outReq.map(r => esc(nameOf(r))).join(', ') + '</div>' : '') + errLine() + '</div>';
    }

    function paint(kind, html) {
        const box = S.box[kind]; if (!box) return;
        const add = box.querySelector('#sqAdd'), msg = box.querySelector('#sqMsg');
        const keep = add ? add.value : null, keepMsg = msg ? msg.value : null, focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
        box.innerHTML = html;
        if (keep != null && box.querySelector('#sqAdd')) box.querySelector('#sqAdd').value = keep;
        if (keepMsg != null && box.querySelector('#sqMsg')) box.querySelector('#sqMsg').value = keepMsg;
        if (focus && box.querySelector('#' + focus)) box.querySelector('#' + focus).focus();
        const c = box.querySelector('#sqChat'); if (c) c.scrollTop = c.scrollHeight;
        hydrate(box);
        wire(box);
    }
    function render() {
        if (S.note) { const t = S.note; S.note = ''; toast({ text: esc(t), warm: true, ms: 2500 }); }
        if (S.err) { const t = S.err; S.err = ''; toast({ text: esc(t), warm: true, ms: 4000 }); }   // los avisos de error tambien como popup: nada pegado debajo de las listas   // los avisos cortos van como popup, no dentro del menu
        if (S.box.rooms) { paint('rooms', roomsHtml()); drawCards(S.box.rooms); const w = document.querySelector('#ahAr .ph .w'); if (w) w.textContent = modeTitle(); }
        if (S.box.friends) paint('friends', friendsHtml());
        try { if (window.PWSquadHooks) { if (PWSquadHooks.afterRender) PWSquadHooks.afterRender(); if (PWSquadHooks.badge) PWSquadHooks.badge(badgeCount()); } } catch (e) {}
    }
    function fail(msg) { S.err = msg; S.note = ''; render(); }
    function start(then) { connect(() => { if (!S.party) send({ a: 'create', name: myName() }); then(); }); }

    function wire(b) {
        b.querySelectorAll('[data-new]').forEach(x => x.onclick = () => {
            snd('simpleselect');
            const n = +x.dataset.new, have = groupSize();
            if (!imLeader()) return fail('Only your group leader can create rooms.');
            if (have !== n) return fail(have === 1 ? 'To play ' + n + 'V' + n + ' you need a group of ' + n + '. Invite friends in FRIENDS.' : 'Your group has ' + have + ' players: pick a ' + have + 'V' + have + ' room.');
            start(() => send({ a: 'play', custom: true, size: n, mode: arMode() }));
        });
        b.querySelectorAll('.sq-card').forEach(x => x.onclick = () => {
            snd('simpleselect');
            const n = +x.dataset.size, have = groupSize();
            if (have !== n) return fail(have === 1 ? 'To play ' + n + 'V' + n + ' you need a group of ' + n + '. Invite friends in FRIENDS.' : 'Your group has ' + have + ' players: pick ' + have + 'V' + have + '.');
            S.err = ''; S.arStep = { size: n, view: null }; render();
        });
        b.querySelectorAll('[data-join]').forEach(x => x.onclick = () => {
            snd('simpleselect');
            const n = +x.dataset.size, have = groupSize();
            if (!imLeader()) return fail('Only your group leader can join rooms.');
            if (have !== n) return fail(have === 1 ? 'That is a ' + n + 'V' + n + ' room: you need a group of ' + n + '. Invite friends in FRIENDS.' : 'Your group has ' + have + ' players: join a ' + have + 'V' + have + ' room.');
            start(() => send({ a: 'challenge', code: x.dataset.join, mode: arMode() }));
        });
        b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => send({ a: 'kick', id: x.dataset.k }));
        b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { if (x.disabled) return; snd('simpleselect'); S.frTab = x.dataset.tab; render(); });
        b.querySelectorAll('[data-nk]').forEach(x => x.onclick = () => { S.nickEdit = x.dataset.nk; render(); const i = b.querySelector('#sqNick'); if (i) i.focus(); });
        b.querySelectorAll('[data-nks]').forEach(x => x.onclick = () => { const i = b.querySelector('#sqNick'); setNick(x.dataset.nks, i ? i.value : ''); S.nickEdit = null; render(); });
        b.querySelectorAll('[data-nkc]').forEach(x => x.onclick = () => { S.nickEdit = null; render(); });
        const nkIn = b.querySelector('#sqNick');
        if (nkIn) nkIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-nks]').click(); };
        b.querySelectorAll('[data-ac]').forEach(x => x.onclick = () => send({ a: 'faccept', id: x.dataset.ac }));
        b.querySelectorAll('[data-dc]').forEach(x => x.onclick = () => send({ a: 'fdecline', id: x.dataset.dc }));
        b.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { if (x.dataset.sure === '1') send({ a: 'fremove', id: x.dataset.rm }); else { x.dataset.sure = '1'; x.textContent = 'SURE?'; setTimeout(() => { if (x.isConnected) { x.dataset.sure = ''; x.textContent = 'X'; } }, 2500); } });
        // Invitar sin grupo crea el grupo (el servidor atiende en orden: create y luego la invitacion).
        b.querySelectorAll('[data-inv]').forEach(x => x.onclick = () => {
            snd('simpleselect'); const id = x.dataset.inv;
            // Buscando partida: primero se avisa de que si aceptan se sale de la cola.
            if (x.dataset.warn === '1' && x.dataset.sure !== '1') { x.dataset.sure = '1'; x.textContent = 'LEAVE QUEUE?'; setTimeout(() => { if (x.isConnected) { x.dataset.sure = ''; x.textContent = 'INVITE'; } }, 3500); return; }
            start(() => send({ a: 'pinvite', id }));
        });
        b.querySelectorAll('[data-w]').forEach(x => x.onclick = () => { S.chatWith = x.dataset.w; S.unread[x.dataset.w] = 0; render(); const i = b.querySelector('#sqMsg'); if (i) i.focus(); });
        const addIn = b.querySelector('#sqAdd');
        if (addIn) addIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="fadd"]').click(); };
        const msgIn = b.querySelector('#sqMsg');
        if (msgIn) msgIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="wsend"]').click(); };
        b.querySelectorAll('[data-a]').forEach(x => x.onclick = () => {
            const a = x.dataset.a; snd('simpleselect');
            if (a === 'quick') start(() => send({ a: 'play', mode: arMode() }));
            else if (a === 'create') { const n = S.arStep.size; if (!imLeader()) return fail('Only your group leader can create rooms.'); start(() => send({ a: 'play', custom: true, size: n, mode: arMode() })); }
            else if (a === 'joinv') { S.arStep.view = 'join'; render(); }
            else if (a === 'stepx') { if (S.arStep && S.arStep.view) S.arStep.view = null; else S.arStep = null; S.err = ''; render(); }
            else if (a === 'rejoin') { send({ a: 'rejoin' }); }
            else if (a === 'practice') send({ a: 'practice' });
            else if (a === 'remind') { send({ a: 'remind' }); S.note = 'Ready check sent to everyone'; render(); setTimeout(() => { S.note = ''; render(); }, 1500); }
            else if (a === 'rok') { send({ a: 'ready', v: true }); hideRc(); }
            else if (a === 'rno') { send({ a: 'ready', v: false }); hideRc(); }
            else if (a === 'cancel') send({ a: 'cancel' });
            else if (a === 'leave') { send({ a: 'leave' }); S.party = null; S.err = ''; render(); }
            else if (a === 'fadd') { const v = (b.querySelector('#sqAdd').value || '').trim(); if (v) { send({ a: 'fadd', u: v }); b.querySelector('#sqAdd').value = ''; S.note = 'Request sent!'; S.err = ''; } }
            else if (a === 'chatx') { S.chatWith = null; render(); }
            else if (a === 'wsend') { const i = b.querySelector('#sqMsg'), v = (i.value || '').trim(); if (v) { send({ a: 'whisper', id: S.chatWith, text: v }); i.value = ''; } }
            else if (a === 'login') login();
            else if (a === 'recheck') loadIdentity(true).then(() => { if (S.x === 'linked') { if (S.ws) { S.ws.close(); } connect(() => send({ a: 'friends' })); } else S.err = 'Not signed in yet.'; render(); });
        });
    }
    function login() {
        // App: el perfil del hub conecta la wallet. PC: la pagina del airdrop.
        if (EN_APP && typeof window._hubConnectX === 'function') { closeAll(); window._hubConnectX(); return; }
        window.open('/airdrop', '_blank');
    }
    // El contador de la busqueda se actualiza sin repintar todo.
    setInterval(() => {
        const q = document.getElementById('sqQ');
        const rq = document.getElementById('sqRcQ');
        if (rq && S.party && S.party.rc) rq.textContent = (imLeader() ? 'WAITING FOR YOUR TEAM' : 'READY CHECK') + ' · ' + RC_TXT[S.party.rc.kind] + ' · ' + Math.max(0, Math.round((S.party.rc.exp - Date.now()) / 1000)) + 's';
        if (q && S.party && S.party.queuedAt) q.textContent = (S.party.custom ? 'ROOM OPEN · WAITING FOR A RIVAL' : 'SEARCHING FOR A RIVAL') + ' · ' + Math.max(0, Math.round((Date.now() - S.party.queuedAt) / 1000)) + 's';
    }, 1000);

    // ---------------- montaje ----------------
    function pcPanel(kind) {
        if (S.pc[kind]) return S.pc[kind];
        const r = document.createElement('div'); r.className = 'sq-pcp'; r.id = 'sqPc' + (kind === 'friends' ? 'Fr' : '');
        r.innerHTML = '<div class="sq-box"><button class="sq-x">CLOSE</button><div class="sq-body"></div></div>';
        r.querySelector('.sq-x').onclick = () => r.classList.remove('open');
        r.addEventListener('click', e => { if (e.target === r) r.classList.remove('open'); });
        document.body.appendChild(r);
        S.pc[kind] = r; return r;
    }
    function isOpen(kind) {
        const hub = document.getElementById(kind === 'friends' ? 'ahFr' : 'ahAr');
        return !!((hub && hub.classList.contains('open')) || (S.pc[kind] && S.pc[kind].classList.contains('open')));
    }
    function closeAll() {
        for (const id of ['ahAr', 'ahFr']) { const e = document.getElementById(id); if (e) e.classList.remove('open'); }
        for (const k of Object.keys(S.pc)) S.pc[k].classList.remove('open');
        clearInterval(S.roomsTimer); S.roomsTimer = null;
    }
    function watchRooms() {
        clearInterval(S.roomsTimer);
        send({ a: 'rooms' });
        S.roomsTimer = setInterval(() => { if (isOpen('rooms') && !(S.party && S.party.state !== 'idle')) send({ a: 'rooms' }); }, 4000);
    }
    // La app monta cada panel dentro del suyo (el hub llama con su contenedor).
    function mountIn(kind, box) {
        S.box[kind] = box; S.err = ''; S.note = ''; if (kind === 'rooms') S.arStep = null;
        if (kind === 'friends') loadIdentity(true).then(() => { connect(() => send({ a: 'friends' })); render(); });
        else connect(watchRooms);
        render();
    }
    function openPc(kind) {
        closePcBackdrops();
        const r = pcPanel(kind); r.classList.add('open');
        S.box[kind] = r.querySelector('.sq-body'); S.err = ''; S.note = ''; if (kind === 'rooms') S.arStep = null;
        try { closePlayChoice(); } catch (e) {}
        if (kind === 'friends') loadIdentity(true).then(() => { connect(() => send({ a: 'friends' })); render(); });
        else connect(watchRooms);
        render();
    }
    function closePcBackdrops() { for (const k of Object.keys(S.pc)) S.pc[k].classList.remove('open'); }
    function open() { if (EN_APP && document.getElementById('ahAr')) return; openPc('rooms'); }
    function openFriends() {
        if (EN_APP && document.getElementById('ahFr')) { const b = document.querySelector('#appHub [data-a="friends"]'); if (b) b.click(); } else openPc('friends');
    }
    // Conexion en segundo plano: con cuenta se reciben invitaciones y susurros aunque el panel este cerrado.
    async function boot() {
        await loadIdentity(true);
        if (S.x === 'linked' && !(S.ws && S.ws.readyState === 1)) connect();
    }
    function joinFromLink() {
        const c = new URLSearchParams(location.search).get('party');
        if (!c || !/^[A-Za-z0-9]{5}$/.test(c)) { setTimeout(boot, 2500); return; }
        setTimeout(() => joinCode(c.toUpperCase()), 1200);
    }
    // PLAY normal con el grupo buscando (o en LISTO): avisa de que se sale de la cola y del grupo, y solo entonces sigue.
    function guardPlay(proceed) {
        const p = S.party;
        if (!p || !(p.state === 'queued' || p.rc)) return proceed();
        let el = document.getElementById('sqGuard');
        if (!el) {
            el = document.createElement('div'); el.id = 'sqGuard';
            el.innerHTML = '<div class="bx"><div>YOU ARE IN THE ARENA QUEUE.<br>PLAYING A NORMAL ROOM LEAVES THE QUEUE AND YOUR GROUP.</div><div class="r"><button class="sq-b" data-g="no">STAY</button><button class="sq-b on" data-g="go">LEAVE & PLAY</button></div></div>';
            frame().appendChild(el);
        }
        el.classList.add('show');
        el.onclick = e => {
            const g = e.target.dataset && e.target.dataset.g; if (!g) return;
            el.classList.remove('show');
            if (g === 'go') { send({ a: 'leave' }); S.party = null; S.err = ''; rivalsBanner(); render(); proceed(); }
        };
    }
    // Las barras y las marcas de companeros solo existen dentro de la partida de arenas.
    setInterval(() => {
        const h = document.getElementById('sqHud');
        if ((h && h.classList.contains('show') || S.rel) && !(typeof gameRunning !== 'undefined' && gameRunning)) { if (h) h.classList.remove('show'); S.rel = null; S.allies = null; rivalsBanner(); }
    }, 700);
    window.pwSquadGuard = guardPlay;
    window.pwSquadIntro = intro;
    window.pwSquadLineup = () => { if (!S.lineup) return null; const d = document.createElement('div'); d.innerHTML = S.lineup; hydrate(d); return d.firstChild; };
    window.pwSquadFrame = frame;
    window.pwToast = toast;
    window.PWSquad = { open, openFriends, mountIn, onRoster, onEnd, onAllies, boot, refreshAv, practiceAgain, dispatch: onMsg, state: S };
    // Para el render: 'ally' (companero, aro azul), 'foe' (rival real, aro rojo) o null.
    window.pwSquadRel = id => (S.rel ? S.rel.get(id) || null : null);
    window.pwSquadTarget = () => (S.allies && Date.now() - S.allies.t < 2500 ? S.allies.tg : null);
    // Flecha azul: cada uno senala a UN companero, siempre el mismo (en corro por orden de id); si muere uno, los dos que quedan se senalan.
    window.pwSquadAllies = () => {
        if (!(S.allies && Date.now() - S.allies.t < 2500)) return null;
        const a = S.allies.a, me = S.roster && S.roster.myId;
        if (!me || a.length < 2) return a;
        const ids = [me].concat(a.map(x => x.id)).sort(), sig = ids[(ids.indexOf(me) + 1) % ids.length];
        return a.filter(x => x.id === sig);
    };
    if (document.readyState === 'complete') joinFromLink(); else addEventListener('load', joinFromLink);
})();
