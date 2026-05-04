import { useEffect } from 'react';

interface SeoMetaOptions {
  title: string;
  description: string;
  canonicalPath: string;
}

const SITE_URL = 'https://hereday.io';

function setMetaContent(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeoMeta({ title, description, canonicalPath }: SeoMetaOptions): void {
  useEffect(() => {
    const url = `${SITE_URL}${canonicalPath}`;
    document.title = title;
    setMetaContent('description', description);
    setLink('canonical', url);
    setMetaContent('og:title', title, 'property');
    setMetaContent('og:description', description, 'property');
    setMetaContent('og:url', url, 'property');
    setMetaContent('twitter:title', title);
    setMetaContent('twitter:description', description);
  }, [title, description, canonicalPath]);
}
