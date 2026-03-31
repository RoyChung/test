let converterPromise: Promise<(text: string) => string> | null = null;

function getCnToHk(): Promise<(text: string) => string> {
  if (!converterPromise) {
    converterPromise = import("opencc-js/cn2t").then(({ Converter }) =>
      Converter({ from: "cn", to: "hk" }),
    );
  }
  return converterPromise;
}

export async function toTraditionalChinese(text: string): Promise<string> {
  if (!text) return text;
  try {
    const convert = await getCnToHk();
    return convert(text);
  } catch {
    return text;
  }
}
