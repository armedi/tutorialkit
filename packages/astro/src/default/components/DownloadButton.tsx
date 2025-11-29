import JSZip from 'jszip';
import { tutorialStore } from './webcontainer.js';

export function DownloadButton() {
  return (
    <button
      title="Download lesson as zip-file"
      className="flex items-center text-2xl text-tk-elements-topBar-iconButton-iconColor hover:text-tk-elements-topBar-iconButton-iconColorHover transition-theme bg-tk-elements-topBar-iconButton-backgroundColor hover:bg-tk-elements-topBar-iconButton-backgroundColorHover p-1 rounded-md"
      onClick={onClick}
    >
      <div className="i-ph-download-simple" />
    </button>
  );
}

async function onClick() {
  const lesson = tutorialStore.lesson;

  if (!lesson) {
    throw new Error('Missing lesson');
  }

  // Get files from the Docker runtime
  const files = tutorialStore.documents.get();
  const zip = new JSZip();

  for (const [filePath, document] of Object.entries(files)) {
    // Skip node_modules
    if (filePath.includes('node_modules')) {
      continue;
    }

    // Remove leading slash for zip paths
    const zipPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    zip.file(zipPath, document.value);
  }

  const data = await zip.generateAsync({ type: 'blob' });

  let filename =
    typeof lesson.data.downloadAsZip === 'object'
      ? lesson.data.downloadAsZip.filename
      : [lesson.part?.id, lesson.chapter?.id, lesson.id].filter(Boolean).join('-');

  if (!filename.endsWith('.zip')) {
    filename += '.zip';
  }

  const link = document.createElement('a');
  link.style.display = 'none';
  link.download = filename;
  link.href = URL.createObjectURL(data);

  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
