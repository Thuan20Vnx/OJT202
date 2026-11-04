export const WORK_TYPES = { unclassified: 'Chưa phân loại', development: 'Coding', testing: 'Testing', database: 'Database', design: 'Design / UI–UX', documentation: 'Documentation', devops: 'DevOps', research: 'Research' };
export const SEVERITIES = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' };
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
export const hoursText = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n ?? 0);
