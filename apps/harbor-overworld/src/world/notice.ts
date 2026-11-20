import { toDigestKey, type PolycentricClient } from '@polycentric/js-core';
import { HARBOR_PRODUCTION_SERVERS } from '../client/client';
import { pickImageVariant, type PostData } from '../data/posts';
import { loadProfile } from '../data/profile';
import { noise } from './terrain';

const WIDTH = 768;
const HEIGHT = 538;
const MARGIN = 38;
const HEADER = 105;
const FOOTER = 489;
const LINE_HEIGHT = 36;
const LINES_PER_PAGE = 10;
const BODY_FONT = '500 30px system-ui, sans-serif';
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const CARD_INK = '#262a32';
const CARD_MUTED = '#5d6576';

type NoticePage =
  | { kind: 'text'; lines: string[] }
  | {
      kind: 'image';
      urls: string[];
      image?: HTMLImageElement;
      requested?: boolean;
      missing?: boolean;
    };

function wrapText(context: CanvasRenderingContext2D, text: string) {
  context.font = BODY_FONT;
  const fits = (line: string) =>
    context.measureText(line).width <= WIDTH - MARGIN * 2;
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u)) {
      const joined = line ? `${line} ${word}` : word;
      if (fits(joined)) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const { segment } of graphemes.segment(word)) {
        if (line && !fits(line + segment)) {
          lines.push(line);
          line = '';
        }
        line += segment;
      }
    }
    lines.push(line);
  }
  return lines;
}

function makePaper() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare Harbor notice paper.');
  const light = context.createLinearGradient(0, 0, WIDTH * 0.72, HEIGHT);
  light.addColorStop(0, '#fbebbd');
  light.addColorStop(0.52, '#f4dfab');
  light.addColorStop(1, '#e6c58d');
  context.fillStyle = light;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y += 5) {
    for (let x = 0; x < WIDTH; x += 5) {
      const grain = noise(x, y);
      if (grain > 0.81) {
        context.fillStyle = grain > 0.91 ? '#fff8d245' : '#8f53201a';
        context.fillRect(x, y, 2, 2);
      }
    }
  }
  context.strokeStyle = '#976b3c66';
  context.lineWidth = 2;
  context.strokeRect(5, 5, WIDTH - 10, HEIGHT - 10);
  context.fillStyle = '#9b6e3c55';
  context.fillRect(MARGIN, HEADER, WIDTH - 2 * MARGIN, 2);
  context.fillRect(MARGIN, FOOTER, WIDTH - 2 * MARGIN, 2);
  for (const x of [16, WIDTH - 21]) {
    for (const y of [16, HEIGHT - 21]) {
      context.fillStyle = '#8c542e';
      context.fillRect(x, y, 6, 6);
      context.fillStyle = '#f6d691';
      context.fillRect(x + 1, y + 1, 2, 2);
    }
  }
  context.fillStyle = '#9c5b32';
  context.fillRect(MARGIN, 30, 28, 20);
  context.strokeStyle = '#f7e3ad';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(MARGIN + 4, 34);
  context.lineTo(MARGIN + 14, 41);
  context.lineTo(MARGIN + 24, 34);
  context.stroke();
  context.font = '700 18px monospace';
  context.fillText('HARBOR POST', MARGIN + 39, 47);
  return canvas;
}

let paper: HTMLCanvasElement | undefined;

function imageUrls(set: PostData['images'][number] | null, width: number) {
  const digest = pickImageVariant(set, width)?.blob?.digest;
  if (!digest) return [];
  const key = toDigestKey(digest);
  return HARBOR_PRODUCTION_SERVERS.map((server) => `${server}/blob/${key}`);
}

function loadImage(
  urls: readonly string[],
  loaded: (image: HTMLImageElement) => void,
  missing?: () => void,
) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => loaded(image);
  let attempt = 0;
  function next() {
    const url = urls[attempt++];
    if (url) image.src = url;
    else missing?.();
  }
  image.onerror = next;
  next();
}

function shortIdentity(identity: string) {
  return identity.length > 14
    ? `${identity.slice(0, 6)}…${identity.slice(-6)}`
    : identity;
}

export class PostNotice {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly pages: NoticePage[] = [];
  private readonly date: string;
  private author: string;
  private avatar?: HTMLImageElement;
  private replyAuthor?: string;
  private authorRequested = false;
  private index = 0;

  constructor(
    readonly post: PostData,
    private readonly onChange: (notice: PostNotice) => void,
    private readonly options: { card?: boolean; author?: string } = {},
  ) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare a Harbor notice.');
    this.context = context;
    this.author = options.author || shortIdentity(post.identity);
    const created = new Date(post.createdAt);
    this.date =
      post.createdAt && Number.isFinite(created.getTime())
        ? DATE.format(created)
        : '';

    if (post.content.trim()) {
      const lines = wrapText(context, post.content.trim());
      for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
        this.pages.push({
          kind: 'text',
          lines: lines.slice(i, i + LINES_PER_PAGE),
        });
      }
    }
    for (const set of post.images) {
      const urls = imageUrls(set, WIDTH);
      if (urls.length) this.pages.push({ kind: 'image', urls });
    }
    if (this.pages.length === 0) {
      this.pages.push({
        kind: 'text',
        lines: ['Open the thread to view this post.'],
      });
    }
    this.draw();
  }

  get pageCount() {
    return this.pages.length;
  }

  get description() {
    const page = this.pages[this.index];
    const content =
      page.kind === 'text' ? page.lines.join('\n') : 'Attached image';
    const reply = this.replyDescription;
    return `${this.author}. ${this.date}. ${reply ? `${reply}. ` : ''}Page ${this.index + 1} of ${this.pageCount}. ${content}`;
  }

  private get replyDescription() {
    if (!this.options.card || !this.post.reply) return '';
    const identity = this.post.reply.parentIdentity;
    const author = this.replyAuthor ?? (identity && shortIdentity(identity));
    return `Replying to ${author || 'a Harbor post'}`;
  }

  turn(client: PolycentricClient, backwards = false) {
    if (this.pageCount < 2) return;
    this.index =
      (this.index + (backwards ? -1 : 1) + this.pageCount) % this.pageCount;
    this.loadAssets(client);
    this.changed();
  }

  loadAssets(client: PolycentricClient) {
    if (!this.authorRequested) {
      this.authorRequested = true;
      void loadProfile(client, this.post.identity)
        .then(({ name, avatar }) => {
          if (name) {
            this.author = name;
            this.changed();
          }
          if (this.options.card && avatar)
            loadImage(imageUrls(avatar, 64), (image) => {
              this.avatar = image;
              this.changed();
            });
        })
        .catch(() => undefined);
      const parent = this.post.reply?.parentIdentity;
      if (this.options.card && parent)
        void loadProfile(client, parent)
          .then(({ name }) => {
            if (!name) return;
            this.replyAuthor = name;
            this.changed();
          })
          .catch(() => undefined);
    }
    const page = this.pages[this.index];
    if (page.kind !== 'image' || page.requested) return;
    page.requested = true;
    loadImage(
      page.urls,
      (image) => {
        page.image = image;
        if (this.pages[this.index] === page) this.changed();
      },
      () => {
        page.missing = true;
        if (this.pages[this.index] === page) this.changed();
      },
    );
  }

  private changed() {
    this.draw();
    this.onChange(this);
  }

  private drawCardHeader() {
    const context = this.context;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.beginPath();
    context.roundRect(2, 2, WIDTH - 4, HEIGHT - 4, 26);
    context.fillStyle = '#fff';
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = '#d8dbe2';
    context.stroke();

    const radius = 29;
    const centerX = MARGIN + radius;
    const centerY = 63;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    if (this.avatar) {
      const { naturalWidth, naturalHeight } = this.avatar;
      const size = Math.min(naturalWidth, naturalHeight);
      context.save();
      context.clip();
      context.drawImage(
        this.avatar,
        (naturalWidth - size) / 2,
        (naturalHeight - size) / 2,
        size,
        size,
        centerX - radius,
        centerY - radius,
        radius * 2,
        radius * 2,
      );
      context.restore();
    } else {
      context.fillStyle = '#ffdac9';
      context.fill();
      context.fillStyle = '#893500';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '750 28px system-ui, sans-serif';
      const initial = graphemes.segment(this.author)[Symbol.iterator]().next()
        .value?.segment;
      context.fillText(initial?.toLocaleUpperCase() ?? '?', centerX, centerY);
      context.textBaseline = 'alphabetic';
    }
    context.textAlign = 'left';
    context.fillStyle = CARD_INK;
    context.font = '750 31px system-ui, sans-serif';
    context.fillText(this.author, MARGIN + radius * 2 + 18, 73, 430);
    context.textAlign = 'right';
    context.font = '500 22px system-ui, sans-serif';
    context.fillStyle = CARD_MUTED;
    context.fillText(this.date, WIDTH - MARGIN, 72, 168);
    context.textAlign = 'left';
    if (this.replyDescription)
      context.fillText(
        `↳ ${this.replyDescription}`,
        MARGIN,
        113,
        WIDTH - MARGIN * 2,
      );
  }

  private drawNoticeHeader() {
    const context = this.context;
    paper ??= makePaper();
    context.drawImage(paper, 0, 0);
    context.fillStyle = '#292319';
    context.textAlign = 'left';
    context.font = '750 32px system-ui, sans-serif';
    context.fillText(this.author, MARGIN, 87, 505);
    context.textAlign = 'right';
    context.fillStyle = '#70512f';
    context.font = '600 18px monospace';
    context.fillText(this.date, WIDTH - MARGIN, 86);
  }

  private draw() {
    const context = this.context;
    if (this.options.card) this.drawCardHeader();
    else this.drawNoticeHeader();
    context.textAlign = 'left';
    context.fillStyle = this.options.card ? CARD_INK : '#251f16';
    context.font = BODY_FONT;
    const page = this.pages[this.index];
    if (page.kind === 'text') {
      for (const [index, line] of page.lines.entries()) {
        context.fillText(
          line,
          MARGIN,
          HEADER + 44 + index * LINE_HEIGHT,
          WIDTH - 2 * MARGIN,
        );
      }
    } else if (page.image) {
      const { naturalWidth, naturalHeight } = page.image;
      const areaHeight = FOOTER - HEADER - 28;
      const scale = Math.min(
        (WIDTH - 2 * MARGIN) / naturalWidth,
        areaHeight / naturalHeight,
      );
      const w = naturalWidth * scale;
      const h = naturalHeight * scale;
      context.drawImage(
        page.image,
        (WIDTH - w) / 2,
        HEADER + 14 + (areaHeight - h) / 2,
        w,
        h,
      );
    } else {
      context.fillText(
        page.missing ? 'Image unavailable' : 'Loading attachment…',
        MARGIN,
        HEADER + 44,
      );
    }

    if (this.pageCount > 1) {
      context.font = '700 20px monospace';
      context.fillStyle = this.options.card ? CARD_MUTED : '#70512f';
      context.fillText(
        `${this.index + 1} / ${this.pageCount}`,
        MARGIN,
        HEIGHT - 17,
      );
    }
  }
}
