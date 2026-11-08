/**
 * ============================================================================
 *  KONFIGURASI FRONTEND — LBH ASYSYUJA
 * ============================================================================
 *
 *  File ini dimuat SEBELUM script utama. Ubah nilainya sesuai kebutuhan.
 *
 *  apiBase:
 *    - '/api'                       → Worker & Pages pada domain yang sama
 *                                     (disarankan, lihat _headers & routes)
 *    - 'https://api.domain.com/api' → Worker pada domain terpisah
 *    - 'https://xxx.workers.dev/api'→ URL workers.dev bawaan
 *
 *  CATATAN: Jangan pernah menaruh API_KEY backend di file ini.
 *  Kunci disimpan sebagai secret di Cloudflare Worker.
 * ============================================================================
 */
window.LBH_CONFIG = {
  apiBase: '/api'
};
