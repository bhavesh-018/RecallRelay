import { Link } from 'react-router-dom';
import { ArrowRight, Check, GitBranch, ClipboardCheck, QrCode, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeToggle } from '../components/ThemeContext';
import './HomePage.css';

const steps = [
  { icon: GitBranch, number: '01', title: 'Find the affected stock.', text: 'Follow a batch from its source to every recorded destination. Know which locations need to act.' },
  { icon: QrCode, number: '02', title: 'Give every location a next step.', text: 'Share a scoped task link. Teams acknowledge the notice, count their stock, and confirm what is set aside.' },
  { icon: ClipboardCheck, number: '03', title: 'Close the loop with evidence.', text: 'Reconcile quantities, surface discrepancies, and review an audit trail of each response.' },
];

export function HomePage() {
  return (
    <div className="rr-home">
      <a className="rr-skip-link" href="#home-content">Skip to content</a>
      <header className="home-header home-width">
        <Link to="/" aria-label="RecallRelay home"><BrandLogo showWordmark size="md" /></Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works" className="home-nav-detail">How it works</a>
          <Link to="/join" className="home-nav-detail">Join a drill</Link>
          <ThemeToggle />
          <Link to="/console" className="home-nav-cta">Open console <ArrowRight size={14} /></Link>
        </nav>
      </header>
      <main id="home-content" tabIndex={-1}>
        <section className="home-hero home-width" aria-labelledby="hero-title">
          <div className="home-eyebrow"><span /> RECALL COORDINATION, CONNECTED</div>
          <h1 id="hero-title">Every batch traced.<br /><span>Every response counts.</span></h1>
          <p className="home-intro">From the first alert to the final stock count. RecallRelay brings your supply chain together to trace affected batches, coordinate action, and account for every recorded unit.</p>
          <div className="home-actions">
            <Link to="/console" className="home-primary">Get started <ArrowRight size={18} /></Link>
            <a href="#how-it-works" className="home-secondary">See how it works <span aria-hidden="true">↗</span></a>
          </div>
          <p className="home-disclaimer"><ShieldCheck size={14} /> Fictional recall drill. Built to practice a more coordinated response.</p>
          <figure className="home-visual">
            <div className="home-visual-bar"><span><span className="home-window-dot" /> RECALLRELAY / BATCH VISIBILITY</span><span className="home-example">ILLUSTRATIVE WORKFLOW</span></div>
            <img src="/recall-network.svg" width="1120" height="420" alt="A batch moves from a manufacturer through a distributor to three shops. Affected locations receive recall tasks and report stock set aside, while an unaffected batch stays outside the recall." />
            <figcaption><span><Check size={15} /> Trace the right batch</span><span><Check size={15} /> Reach the right locations</span><span><Check size={15} /> Verify each response</span></figcaption>
          </figure>
        </section>
        <section id="how-it-works" className="home-how home-width" aria-labelledby="how-title">
          <div className="home-section-heading"><div><div className="home-eyebrow">FROM ALERT TO ACCOUNTABILITY</div><h2 id="how-title">One shared picture.<br />A clear path to action.</h2></div><p>Replace disconnected updates with a traceable workflow. See what has been confirmed and where attention is still needed.</p></div>
          <div className="home-steps">{steps.map(({ icon: Icon, number, title, text }) => <article key={number}><div className="home-step-top"><Icon size={22} strokeWidth={1.5} /><span>{number}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div>
        </section>
        <section className="home-bottom home-width"><div><h2>Practice the response.<br />Make the next step clear.</h2><p>Explore the operator console or take part in a fictional drill.</p></div><div className="home-actions"><Link to="/console" className="home-primary">Get started <ArrowRight size={18} /></Link><Link to="/join" className="home-secondary">Join a drill</Link></div></section>
      </main>
      <footer className="home-footer home-width"><BrandLogo showWordmark /><span>Fictional recall drill. Real coordination, made visible.</span></footer>
    </div>
  );
}
