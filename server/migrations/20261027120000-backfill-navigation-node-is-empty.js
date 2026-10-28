"use strict";

// Records on each node of every collection's document structure whether the
// document is empty, matching ProsemirrorDataHelper.isEmpty: no content, or a
// single paragraph with nothing in it. Safe to re-run.
const emptyDocumentIdsQuery = `
  SELECT id FROM documents
  WHERE "collectionId" = :collectionId
    AND (
      content IS NULL
      OR jsonb_array_length(COALESCE(NULLIF(content->'content', 'null'::jsonb), '[]'::jsonb)) = 0
      OR (
        jsonb_array_length(content->'content') = 1
        AND content->'content'->0->>'type' = 'paragraph'
        AND jsonb_array_length(COALESCE(NULLIF(content->'content'->0->'content', 'null'::jsonb), '[]'::jsonb)) = 0
      )
    )
`;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const collections = await queryInterface.sequelize.query(
      `SELECT id FROM collections WHERE "documentStructure" IS NOT NULL`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    for (const { id } of collections) {
      await queryInterface.sequelize.transaction(async (transaction) => {
        const [collection] = await queryInterface.sequelize.query(
          `SELECT "documentStructure" FROM collections WHERE id = :id FOR NO KEY UPDATE`,
          {
            replacements: { id },
            type: queryInterface.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );
        const emptyIds = new Set(
          (
            await queryInterface.sequelize.query(emptyDocumentIdsQuery, {
              replacements: { collectionId: id },
              type: queryInterface.sequelize.QueryTypes.SELECT,
              transaction,
            })
          ).map((row) => row.id)
        );

        const mark = (nodes) =>
          nodes.map((node) => ({
            ...node,
            isEmpty: emptyIds.has(node.id),
            children: mark(node.children ?? []),
          }));

        await queryInterface.sequelize.query(
          `UPDATE collections SET "documentStructure" = :structure WHERE id = :id`,
          {
            replacements: {
              id,
              structure: JSON.stringify(mark(collection.documentStructure)),
            },
            transaction,
          }
        );
      });
    }
  },

  // The extra field is ignored by earlier versions, so there is nothing to undo.
  async down() {},
};
