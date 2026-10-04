import { useState } from "react";
import type { Recipe, Resource } from "../types";
import { compareRecipes } from "../lib/recipeComparison";
import { deriveRecipeTitle } from "../lib/recipeTitle";
import { Button, Field, Modal, Select } from "./ui";

export function RecipeCompareDialog({ recipes, resources, privacyMode, onClose }: {
  recipes: Recipe[]; resources: Resource[]; privacyMode: boolean; onClose: () => void;
}) {
  const [leftId, setLeftId] = useState(recipes[0]?.id || "");
  const [rightId, setRightId] = useState(recipes[1]?.id || "");
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const left = recipes.find((recipe) => recipe.id === leftId);
  const right = recipes.find((recipe) => recipe.id === rightId);
  const fields = left && right ? compareRecipes(left, right, resources) : [];
  const visible = fields.filter((field) => (!onlyDifferences || field.different) &&
    (!privacyMode || !["Positive prompt", "Negative prompt", "Notes"].includes(field.label)));
  const title = (recipe: Recipe) => deriveRecipeTitle(recipe.title, privacyMode ? "" : recipe.positivePrompt);
  function cover(recipe: Recipe) {
    const image = recipe.assets.find((asset) => asset.id === recipe.coverAssetId) || recipe.assets[0];
    return image?.url ? <img src={image.url} alt={`Result for ${title(recipe)}`} /> : <div className="compare-no-image">No cover image</div>;
  }
  return <Modal title="Compare recipes" eyebrow="Results & settings" size="xl" onClose={onClose}
    footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
    <div className="recipe-comparison">
      <div className="compare-selectors">
        {[ { label: "Left recipe", id: leftId, setter: setLeftId }, { label: "Right recipe", id: rightId, setter: setRightId } ].map(({label, id, setter}) =>
          <Field key={label} label={label}>
            <Select value={id} onChange={(event) => setter(event.target.value)}>
              {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{title(recipe)}</option>)}
            </Select>
          </Field>)}
      </div>
      {left && right && !privacyMode ? <div className="compare-covers">{cover(left)}{cover(right)}</div> : null}
      <div className="compare-summary">
        <span role="status">{fields.filter((field) => field.different).length} fields differ</span>
        <label><input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} /> Only differences</label>
      </div>
      {privacyMode ? <p>Prompts, notes, and images are hidden in privacy mode.</p> : null}
      {leftId === rightId ? <p>Select two different recipes to compare results.</p> : null}
      {visible.length ? <table className="compare-table"><thead><tr><th scope="col">Field</th><th scope="col">{left ? title(left) : "Left"}</th><th scope="col">{right ? title(right) : "Right"}</th></tr></thead>
        <tbody>{visible.map((field) => <tr key={field.label} className={field.different ? "is-different" : undefined}>
          <th scope="row">{field.label}{field.different ? <small>Changed</small> : null}</th><td>{field.left}</td><td>{field.right}</td>
        </tr>)}</tbody></table> : <p>{privacyMode ? "No visible differences. Turn off privacy mode to inspect prompts and notes." : "No differences in the compared fields."}</p>}
      <p className="compare-footnote">This comparison shows saved recipe fields. It does not compare every node in the original graphs.</p>
    </div>
  </Modal>;
}
