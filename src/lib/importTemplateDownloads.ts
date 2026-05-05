import JSZip from 'jszip';
import Papa from 'papaparse';

export const QUESTION_IMPORT_TEMPLATE_FILENAME = 'questions-template.csv';
export const QUESTION_IMPORT_ZIP_TEMPLATE_FILENAME = 'questions-import-template.zip';

const TEMPLATE_COLUMNS = [
  'text',
  'image_file',
  'mask_file',
  'reveal_file',
  'default_time_limit_seconds',
  'default_max_score',
  'default_min_correct_score',
  'default_circle_radius_ratio',
  'difficulty',
  'tags',
  'is_published',
] as const;

type TemplateRow = Record<(typeof TEMPLATE_COLUMNS)[number], string>;

const TEMPLATE_ROWS: TemplateRow[] = [
  {
    text: 'หาโลโก้ที่ซ่อนอยู่ตรงไหน?',
    image_file: 'q1.jpg',
    mask_file: 'q1_mask.png',
    reveal_file: 'q1_reveal.png',
    default_time_limit_seconds: '30',
    default_max_score: '1000',
    default_min_correct_score: '100',
    default_circle_radius_ratio: '0.10',
    difficulty: 'normal',
    tags: 'logo,brand',
    is_published: 'true',
  },
  {
    text: 'แตะช้างในภาพ',
    image_file: 'q2.jpg',
    mask_file: 'q2_mask.png',
    reveal_file: '',
    default_time_limit_seconds: '20',
    default_max_score: '1200',
    default_min_correct_score: '100',
    default_circle_radius_ratio: '0.08',
    difficulty: 'hard',
    tags: 'animal',
    is_published: 'true',
  },
];

const IMAGES_README = 'images/: put question images here, e.g. q1.jpg\n';
const MASKS_README = 'masks/: put mask files here, e.g. q1_mask.png\n';
const REVEALS_README = 'reveals/: optional reveal images here, e.g. q1_reveal.png\n';

export function buildQuestionImportTemplateCsv(): string {
  return Papa.unparse(TEMPLATE_ROWS, {
    columns: [...TEMPLATE_COLUMNS],
    newline: '\n',
  });
}

export function downloadBlobFile(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function downloadTextFile(text: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  downloadBlobFile(new Blob([text], { type }), filename);
}

export function downloadQuestionImportTemplateCsv(): void {
  downloadTextFile(buildQuestionImportTemplateCsv(), QUESTION_IMPORT_TEMPLATE_FILENAME, 'text/csv;charset=utf-8');
}

export async function downloadQuestionImportTemplateZip(): Promise<void> {
  const zip = new JSZip();
  zip.file('questions.csv', buildQuestionImportTemplateCsv());
  zip.file('images/README.txt', IMAGES_README);
  zip.file('masks/README.txt', MASKS_README);
  zip.file('reveals/README.txt', REVEALS_README);

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlobFile(blob, QUESTION_IMPORT_ZIP_TEMPLATE_FILENAME);
}
