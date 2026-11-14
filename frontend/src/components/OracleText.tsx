import { Fragment } from 'react';
import { splitSymbols } from '../lib/mana';
import { ManaSymbol } from './ManaSymbol';

interface Props {
  /** Rules text as Scryfall gives it, e.g. "{T}: Add {G}.", with \n between paragraphs. */
  text: string;
  className?: string;
}

/** A card's rules text, with its symbols ({T}, {G}…) shown as images and read out in words. */
export function OracleText({ text, className }: Props) {
  return (
    <p className={['oracle-text', className].filter(Boolean).join(' ')}>
      {splitSymbols(text).map((part, i) => (
        <Fragment key={i}>{'symbol' in part ? <ManaSymbol symbol={part.symbol} /> : part.text}</Fragment>
      ))}
    </p>
  );
}
