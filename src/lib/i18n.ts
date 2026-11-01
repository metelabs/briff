// Strings shown around bulletin content (email and the bulletin page). The
// product is English only (bulletin.md §15); the Turkish strings stay for a
// later language option and are not reachable from the UI.

export const LANGUAGES = ["tr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const PRODUCT_LANGUAGE: Language = "en";

export function asLanguage(value: string | null | undefined): Language {
  return value === "tr" ? "tr" : "en";
}

/**
 * Upper-cases a label with a fixed locale. CSS `text-transform` and bare
 * `toLocaleUpperCase()` follow the document or system locale, which under `tr`
 * turns "Security" into "SECURİTY".
 */
export function caps(text: string): string {
  return text.toLocaleUpperCase("en-US");
}

const STRINGS = {
  tr: {
    section_security: "Güvenlik",
    act_title: "Bu hafta yap",
    know_title: "Bil, acele yok",
    rest_title: "Gerisi",
    rest_line: (items: number, minor: number) =>
      items === 0
        ? `Ayrıca ${minor} küçük sürüm notu.`
        : minor > 0
          ? `Ayrıca ${items + minor} madde daha (${minor} küçük sürüm notu dahil).`
          : `Ayrıca ${items} madde daha.`,
    rest_link: "Tam liste Briff'te",
    alerts_line: (n: number) => `Bu hafta ${n} yeni güvenlik uyarısı.`,
    backlog_line: (n: number) => `İlk taramadan ${n} eski uyarı bülten sayfasında listeleniyor.`,
    details: "Ayrıntı",
    due: "Son tarih",
    also_released: "Bu hafta ayrıca",
    todo_upgrade: "Yükselt",
    todo_read: "Oku",
    todo_wait: "Bekle",
    todo_ignore: "İlgisiz",
    nothing_to_do: "Bu hafta yapman gereken bir şey yok.",
    act_fallback_security: (pkg: string) =>
      `${pkg} paketini düzeltilmiş bir sürüme yükselt; güvenlik uyarısına bak.`,
    act_fallback: "Ayrıntıyı oku ve son tarihten önce gerekeni yap.",
    line_also_affected: (repos: readonly string[]) => `Şunları da etkiliyor: ${repos.join(", ")}.`,
    act_transitive: (pkg: string, why = `npm ls ${pkg}`) =>
      `${pkg} dolaylı bir bağımlılık: onu çeken paketleri güncelle (${why} hangileri olduğunu gösterir).`,
    affected: "Etkilenen repolar",
    source: "Kaynak",
    sources: "Kaynaklar",
    open: "Briff'te aç",
    fb_up: "Faydalı",
    fb_down: "Faydasız",
    fb_less: "Bundan daha az",
    minor: (n: number) => `Ayrıca ${n} küçük güncelleme listelenmedi.`,
    minor_more: (n: number) => `Ayrıca ${n} küçük güncelleme daha listelenmedi.`,
    minor_label: "Küçük",
    alerts_title: "Bu haftanın yeni güvenlik uyarıları",
    backlog_title: (n: number) => `İlk taramadan eski uyarılar (${n})`,
    fixed: "Düzeltildiği sürüm",
    footer:
      "Bu bülten taradığın repolardan üretildi. Hangi repoların gireceğini Briff'te seçebilirsin.",
    week: (w: string) => `${w} haftası`,
    estimated: "tahmin",
    feedback_saved: "Geri bildirimin kaydedildi.",
    feedback_invalid: "Bu geri bildirim bağlantısı geçersiz ya da süresi dolmuş.",
    alert_subject: "güvenlik",
    alert_intro: (n: number) =>
      n === 1
        ? "Yeni bir güvenlik uyarısı repolarını etkiliyor."
        : `${n} yeni güvenlik uyarısı repolarını etkiliyor.`,
    repos: "Repolar",
    transitive: "dolaylı",
    no_fix: "henüz düzeltme yok",
    alert_more: (n: number) => `${n} uyarı daha:`,
    alert_transitive_title: "Dolaylı bağımlılıklar",
    alert_transitive_note: "Başka paketler üzerinden geliyorlar; onları çeken paketleri güncelle.",
    first_scan_subject: (n: number) => `ilk tarama: bilinen ${n} uyarı`,
    first_scan_intro: (repos: number, n: number, severe: number) =>
      `İlk tarama ${repos} repoda bilinen ${n} uyarı buldu (${severe} kritik ya da yüksek).`,
    first_scan_body:
      "Bunlar yeni değil, tek tek gönderilmiyor. Bir sonraki haftalık bültenin sayfasında ayrı bir grupta listelenecekler. Bundan sonra yalnız yeni kritik ve yüksek uyarılar e-postayla gelir.",
    alerts_not_listed: (n: number) => `Daha düşük öncelikli ${n} uyarı daha listelenmedi.`,
    advisories: (n: number) => `${n} uyarı`,
    related: "İlgili",
    no_line_fix: "kurulu sürüm hattında düzeltme yok",
    alert_footer:
      "Kurulu sürümlerin OSV.dev ile eşleştirildi. Kritik ve yüksek uyarılar aynı gün, diğerleri haftalık bültende gelir. Aynı uyarı aynı repo için bir kez gönderilir.",
    urgent_subject: "acil",
    urgent_intro: "Stack'ini ilgilendiren, haftalık bülteni beklememesi gereken duyurular.",
    urgent_footer: "Haftalık bültende de yer alacaklar.",
    runtime_announced: (name: string, when: string) =>
      `${name}, ${when} için bir güvenlik sürümü duyurdu.`,
    runtime_runs: (repo: string, runs: string) => `${repo}: ${runs}`,
    urgent_subject_addition: (n: number) => `acil · ${n} repoyu daha etkiliyor`,
    urgent_subject_fix: "acil · düzeltme yayında",
    runtime_also_affects: (repos: string, since: string) =>
      `Bunları da etkiliyor: ${repos} (${since} uyarısından sonra eklendi).`,
    runtime_fix_out: (name: string, versions: string) =>
      `Düzeltilmiş ${name} sürümleri yayında: ${versions}.`,
    runtime_not_affected: (repos: string) => `Etkilenmeyenler: ${repos}.`,
    runtime_no_version: (repo: string, name: string) =>
      `${repo}: kayıtlı ${name} sürümü yok; hangi sürümün çalıştığını kontrol et`,
    todo: "Yapılacak",
    bucket_security: "Güvenlik",
    test_subject: "Briff · deneme e-postası",
    test_body: "E-posta teslimatı çalışıyor. Bülten ve güvenlik uyarıları bu adrese gelecek.",
    base_image_subject: "taban imaj düzeltmeleri",
    base_image_intro: (n: number) =>
      n === 1
        ? "Bir taban imajın dağıtım sürümü için düzeltme yayımlandı."
        : `${n} taban imajın dağıtım sürümü için düzeltme yayımlandı.`,
    base_image_more: (n: number) => `ve ${n} tane daha`,
    base_image_footer:
      "Briff imajın içindeki paketleri göremez. Bunlar imajın dağıtım sürümünde izlenen taban paketler için son 14 günde yayımlanan düzeltmeler; imajı en son etiketle yeniden derlemek onları alır. Aynı düzeltme aynı imaj için bir kez gönderilir.",
  },
  en: {
    section_security: "Security",
    act_title: "Needs your attention",
    know_title: "Good to know",
    rest_title: "Also this week",
    rest_line: (items: number, minor: number) =>
      items === 0
        ? `Also ${minor} minor release notes.`
        : minor > 0
          ? `Also ${items + minor} more items (${minor} of them minor release notes).`
          : `Also ${items} more items.`,
    rest_link: "Full list in Briff",
    alerts_line: (n: number) =>
      n === 1 ? "1 new security advisory this week." : `${n} new security advisories this week.`,
    backlog_line: (n: number) =>
      n === 1
        ? "1 older advisory from the first scan is listed on the bulletin page."
        : `${n} older advisories from the first scan are listed on the bulletin page.`,
    details: "Details",
    due: "Due",
    also_released: "Also released",
    todo_upgrade: "Upgrade",
    todo_read: "Read",
    todo_wait: "Wait",
    todo_ignore: "Skip",
    nothing_to_do: "Nothing needs your attention this week.",
    act_fallback_security: (pkg: string) =>
      `Upgrade ${pkg} to a fixed version; see the security alert.`,
    act_fallback: "Read the details and act before the deadline.",
    line_also_affected: (repos: readonly string[]) => `Also affects ${repos.join(", ")}.`,
    act_transitive: (pkg: string, why = `npm ls ${pkg}`) =>
      `${pkg} is a transitive dependency: update the packages that pull it in (${why} shows which).`,
    affected: "Affected repos",
    source: "Source",
    sources: "Sources",
    open: "Open in Briff",
    fb_up: "Useful",
    fb_down: "Not useful",
    fb_less: "Less of this",
    minor: (n: number) => `Also ${n} minor updates, not listed.`,
    minor_more: (n: number) => `Also ${n} more minor updates, not listed.`,
    minor_label: "Minor",
    alerts_title: "New security advisories this week",
    backlog_title: (n: number) => `Older advisories from the first scan (${n})`,
    fixed: "Fixed in",
    footer:
      "This briefing is built from the repos you scan. Choose which repos go into each bulletin in Briff.",
    week: (w: string) => `Week ${w}`,
    estimated: "estimated",
    feedback_saved: "Your feedback was saved.",
    feedback_invalid: "This feedback link is invalid or has expired.",
    alert_subject: "security",
    alert_intro: (n: number) =>
      n === 1
        ? "A new security advisory affects your repos."
        : `${n} new security advisories affect your repos.`,
    repos: "Repos",
    transitive: "transitive",
    no_fix: "no fix yet",
    /** Heads the list of the remaining advisories in the alert email. */
    alert_more: (n: number) => `${n} more advisories:`,
    alert_transitive_title: "Transitive dependencies",
    alert_transitive_note:
      "These come in through other packages; update the packages that pull them in.",
    first_scan_subject: (n: number) => `first scan: ${n} known advisories`,
    first_scan_intro: (repos: number, n: number, severe: number) =>
      `The first scan of ${repos === 1 ? "1 repo" : `${repos} repos`} found ${n === 1 ? "1 known advisory" : `${n} known advisories`} (${severe} critical or high).`,
    first_scan_body:
      "They are not news, so they are not sent one by one. The next weekly bulletin lists them on its page in a separate group. From now on only new critical and high advisories are emailed the same day.",
    /** Bulletin page: nothing follows, so a full sentence. */
    alerts_not_listed: (n: number) =>
      n === 1
        ? "1 more, lower-priority advisory is not listed."
        : `${n} more, lower-priority advisories are not listed.`,
    advisories: (n: number) => (n === 1 ? "1 advisory" : `${n} advisories`),
    related: "Related",
    no_line_fix: "no fix on the installed release line",
    alert_footer:
      "Your installed versions were matched against OSV.dev. Critical and high advisories are emailed the same day, the rest wait for the weekly bulletin. Each advisory is sent once per repo.",
    urgent_subject: "urgent",
    urgent_intro: "Announcements about your stack that should not wait for the weekly briefing.",
    urgent_footer: "They will also appear in the weekly briefing.",
    runtime_announced: (name: string, when: string) =>
      `${name} announced a security release for ${when}.`,
    runtime_runs: (repo: string, runs: string) => `${repo} runs ${runs}`,
    urgent_subject_addition: (n: number) =>
      `urgent · also affects ${n} more ${n === 1 ? "repo" : "repos"}`,
    urgent_subject_fix: "urgent · fix released",
    runtime_also_affects: (repos: string, since: string) =>
      `Also affects ${repos} (added after the alert of ${since}).`,
    runtime_fix_out: (name: string, versions: string) =>
      `The fixed ${name} releases are out: ${versions}.`,
    runtime_not_affected: (repos: string) => `Not affected: ${repos}.`,
    runtime_no_version: (repo: string, name: string) =>
      `${repo}: no ${name} version on record; check which version runs`,
    todo: "To do",
    bucket_security: "Security",
    test_subject: "Briff · test email",
    test_body: "Email delivery works. Bulletins and security alerts will arrive at this address.",
    base_image_subject: "base image fixes",
    base_image_intro: (n: number) =>
      n === 1
        ? "A fix was published for the distro release of one of your base images."
        : `Fixes were published for the distro releases of ${n} of your base images.`,
    base_image_more: (n: number) => `and ${n} more`,
    base_image_footer:
      "Briff cannot see the packages inside your images. These are fixes published in the last 14 days for the watched base packages of the image's distro release; rebuilding on the latest tag picks them up. Each fix is sent once per image.",
  },
} as const;

export type Strings = (typeof STRINGS)[Language];

export function strings(language: Language): Strings {
  return STRINGS[language];
}

export function todoLabel(
  language: Language,
  todo: "upgrade" | "read" | "wait" | "ignore"
): string {
  const s = STRINGS[language];
  switch (todo) {
    case "upgrade":
      return s.todo_upgrade;
    case "read":
      return s.todo_read;
    case "wait":
      return s.todo_wait;
    case "ignore":
      return s.todo_ignore;
  }
}
