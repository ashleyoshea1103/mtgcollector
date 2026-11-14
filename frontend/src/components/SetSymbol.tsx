import { useState, type CSSProperties } from 'react';
import { corsIconUrl, isOnHost, SCRYFALL_SVG_HOST } from '../lib/urls';
import type { CardSet, Rarity } from '../types';
import { TooltipText } from '../ui';

interface Props {
  set: CardSet;
  /** The printing's rarity: the symbol is drawn in its colour, as on the card. Left out where there's no single printing (a group header). */
  rarity?: Rarity;
  /**
   * Set when the set's name is shown as text right beside the symbol: screen readers then
   * skip the symbol, rather than read the set twice.
   */
  nameShown?: boolean;
}

/**
 * The set's symbol, drawn in the rarity's colour as on the card itself; screen readers read
 * the set's name instead, and hovering shows it. The set code is shown instead when there's
 * no symbol or it fails to load.
 *
 * Scryfall's SVG is used as a CSS mask over the colour (an <img> can't be recoloured). As a
 * mask, like an <img>, it's only ever drawn as an image: scripts inside it never run. The
 * URL is safe to put in url("…"): isOnHost only allows letters, digits and /._~%-?=&+, so it
 * can't close the string.
 */
export function SetSymbol({ set, rarity, nameShown = false }: Props) {
  const icon = set.icon_svg_uri !== null && isOnHost(set.icon_svg_uri, SCRYFALL_SVG_HOST) ? corsIconUrl(set.icon_svg_uri) : null;
  // A mask has no load or error events, so a hidden <img> of the same URL, fetched the same
  // way (CORS, so the browser fetches it once), reports them: a failure shows the code, and
  // a load gives the symbol's proportions. Both are kept per URL, so a new icon starts over.
  const [failed, setFailed] = useState<string | null>(null);
  const [ratio, setRatio] = useState<{ url: string; value: number } | null>(null);
  const shown = icon !== null && icon !== failed ? icon : null;
  const style = {
    '--set-icon': `url("${shown}")`,
    ...(ratio?.url === shown && { '--set-icon-ratio': ratio.value }),
  } as CSSProperties;
  return (
    <TooltipText as="abbr" className={`set-symbol${rarity ? ` set-symbol--${rarity}` : ''}`} tooltip={set.name} announce={!nameShown}>
      {shown ? (
        <>
          <span className="set-symbol__icon" style={style} />
          {/* Not lazy: hidden, a lazy image would never load, and a failure would go unseen. */}
          <img
            className="set-symbol__probe"
            src={shown}
            alt=""
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onError={() => setFailed(shown)}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w > 0 && h > 0) setRatio({ url: shown, value: w / h });
            }}
          />
        </>
      ) : (
        <span className="set-symbol__code">{set.code.toUpperCase()}</span>
      )}
    </TooltipText>
  );
}
